from functools import wraps
from flask import Flask, jsonify, request
from flask_cors import CORS
import threading
from threading import Lock
import sys
import os
import json
import time

from orator import DatabaseManager, Model
from orator.orm import belongs_to, has_many
from orator.exceptions.orm import ModelNotFound

from google.cloud import pubsub
from oauth2client.service_account import ServiceAccountCredentials
from googleapiclient import discovery

import config

db = DatabaseManager(config.DATABASES)
Model.set_connection_resolver(db)
app = Flask(__name__)
CORS(app)

###################################################################################################
#                                             MODELS                                              #
###################################################################################################
class Client(Model):
    __table__ = 'clients'
    __fillable__ = ['name', 'access_token']

    @has_many
    def devices(self):
      return Device

class Device(Model):
    __table__ = 'devices'
    __fillable__ = ['external_id']

    @belongs_to
    def client(self):
        return Client

class Signal(Model):
    __table__ = 'signals'
    __fillable__ = ['external_uuid', 'signal']

    @belongs_to
    def device(self):
        return Device

    @has_many
    def signals(self):
      return Signal

###################################################################################################
#                                             HELPERS                                             #
###################################################################################################
def access_token_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        token = request.headers.get('Authorization')
        try:
            client = Client.where('access_token', token).first_or_fail()
        except ModelNotFound as e:
            return '', 401
        return f(client, *args, **kwargs)
    return decorated_function

###################################################################################################
#                                             THREADS                                             #
###################################################################################################
class MQTTListener(threading.Thread):
    def __init__(self):
        super(MQTTListener, self).__init__()
        self.credentials = ServiceAccountCredentials.from_json_keyfile_name(
            os.environ['JSON_KEY_FILE'], ['https://www.googleapis.com/auth/cloud-platform']
        )

        if not self.credentials:
            sys.exit('Could not load service account credential')

    def run(self):
        """The main loop. Consumes messages from the Pub/Sub subscription."""
        subscriber = pubsub.SubscriberClient()
        subscription_path = subscriber.subscription_path(os.environ['GCLOUD_PROJECT_ID'], 'signal')

        def callback(message):
            """Logic executed when a message is received from subscribed topic."""
            try:
                device_id = message.attributes['deviceId']
                data = json.loads(message.data)
                signal = data['signal']
                uuid = data['uuid']

                try:
                  device = Device.where('external_id', device_id).first_or_fail()
                  db.table('signals').insert({
                      'external_uuid': uuid,
                      'signal': json.dumps(signal),
                      'device_id': device.id
                  })
                except ModelNotFound as e:
                  print('Device with id {} not found', device_id)

            except ValueError as e:
                print('Loading Payload ({}) threw an Exception: {}.'.format(message.data, e))
                message.ack()
                return

            message.ack()

        print('Listening for messages on {}'.format(subscription_path))
        subscriber.subscribe(subscription_path, callback=callback)

        # The subscriber is non-blocking, so keep the main thread from
        # exiting to allow it to process messages in the background.
        while True:
            time.sleep(60)

thread = MQTTListener()
thread.start()

###################################################################################################
#                                            ENDPOINTS                                            #
###################################################################################################
@app.route("/api/v1/signals/<uuid>", methods=['GET'])
@access_token_required
def get_signal(client, uuid):
    """Clients will use this endpoint to check if a signal has been received by the server"""
    try:
        signal = Signal.where('external_uuid', uuid).first_or_fail()
        if signal.device.client_id != client.id:
            return '', 403
        return '', 204
    except ModelNotFound as e:
        return '', 404


@app.route("/api/v1/signals/compare", methods=['POST'])
@access_token_required
def compare_signals(client):
    """Clients will use this endpoint to see if 2 signals are similar"""
    try:
        signal_1 = Signal.where('external_uuid', request.get_json().get('signal_1_uuid')).first_or_fail()
        signal_2 = Signal.where('external_uuid', request.get_json().get('signal_2_uuid')).first_or_fail()

        if (signal_1.device.client_id != client.id) or (signal_2.device.client_id != client.id):
            return '', 403

        return jsonify({ 'percentage': 1 }), 200 # TODO: calculate difference
    except ModelNotFound as e:
        return '', 404


@app.route("/api/v1/devices", methods=['GET'])
@access_token_required
def get_devices(client):
    """Clients will use this endpoint to get the devices info (IP)"""
    return jsonify(
        list(map(lambda x: { 'ip_address': x.ip_address, 'id': x.external_id }, client.devices))
    ), 200

if __name__ == "__main__":
    app.run(host='127.0.0.1', port=5001)
    # app.run(host='0.0.0.0', port=80)
