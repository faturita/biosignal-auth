import React, { Component } from 'react';
import PropTypes from 'prop-types';

import './Form.css';
import ClientService from '../../services/clientService';
import SignalService from '../../services/signalService';
import CustomChart from '../CustomChart/CustomChart';
import CustomSlider from '../CustomSlider/CustomSlider';
import RefreshIcon from '../../assets/refresh.png';

class Form extends Component {
  constructor(props) {
    super(props);
    this.state = {
      started: false,
      error: undefined,
      email: undefined,
      password: undefined,
      deviceOptions: [],
      signalUUID: undefined,
      readyToSend: false,
      readerIP: undefined,
      settings: {
        windowSize: 50,
        spikeThreshold: 650,
        zeroThreshold: 250,
        zeroLength: 500,
      }
    };
  }

  handlePasswordChange = event => {
    this.setState({password: event.target.value});
  };

  handleEmailChange = event => {
    this.setState({email: event.target.value});
  };

  handleSettingChange = (label, value) => {
    const newSettings = { ...this.state.settings };
    newSettings[label] = value;
    this.setState({
      settings: newSettings
    });
    SignalService.updateSettings(this.state.readerIP, newSettings.windowSize, newSettings.spikeThreshold, newSettings.zeroThreshold, newSettings.zeroLength)
      .then(response => {
        if (response.status === 200) {
          console.log('Settings changed');
          console.log(response.data);
        }
      });
  }

  handleWindowSizeChange = value => {
    this.handleSettingChange('windowSize', value);
  };

  handleSpikeThresholdChange = value => {
    this.handleSettingChange('spikeThreshold', value);
  };

  handleZeroThresholdChange = value => {
    this.handleSettingChange('zeroThreshold', value);
  };

  handleZeroLengthChange = value => {
    this.handleSettingChange('zeroLength', value);
  };

  deviceName = device => `${device.name} ${device.ip}`;

  handleDeviceChange = event => {
    const name = event.target.value;
    const device = this.state.deviceOptions.filter(a => a.name === name)[0];
    this.setState({
      readerIP: device.ip
    }, () => {
      SignalService.getSettings(this.state.readerIP)
      .then(response => {
        this.setState({
          settings: {
            windowSize: response.data.window_size,
            spikeThreshold: response.data.spike_threshold,
            zeroThreshold: response.data.zero_threshold,
            zeroLength: response.data.zero_length,
          }
        });
      });
    });
  };

  startReading = () => {
    SignalService.start(this.state.readerIP)
      .then(response => {
        if (response.status === 201) {
          this.setState({started: true, signalUUID: response.data.signalUUID, readyToSend: false});
        } else {
          console.log(`Unexpected response code ${response.status}`);
        }
      });
  };

  stopReading = () => {
    SignalService.stop(this.state.readerIP, this.state.signalUUID)
      .then(response => {
        if (response.status === 200) {
          this.setState({started: false});
          this.checkIfSignalArrived();
        } else {
          this.setState({error: `Unexpected response code ${response.status}`});
        }
      });
  };

  checkIfSignalArrived = () => {
    this.timer = setInterval(() => {
      if (!this.state.readyToSend) {
        ClientService.signalExist(this.state.signalUUID)
          .then(response => this.setState({ readyToSend: true }));
      }
    }, 500);
  };

  refreshItems = () => {
    ClientService.devices()
      .then(response => {
        const mapped_response = response.data.map(info => ({ name: info.id, ip: info.ip_address }));
        mapped_response.unshift({name: '', ip: ''});
        this.setState({
          deviceOptions: mapped_response
        });
      });
  };

  cancelReading = () => {
    this.setState({
      started: false,
      signalUUID: '',
    });
    SignalService.cancel(this.state.readerIP, this.state.signalUUID);
  };

  componentDidMount() {
    this.refreshItems();
  }

  componentWillUnmount() {
    if (this.state.started && this.state.signalUUID) {
      this.cancelReading();
    }
  }

  render() {
    return (
      <div>
        {
          this.state.error || this.props.externalError
            ? <div className="alert alert-danger" role="alert">{this.state.error || this.props.externalError}</div>
            : null
        }
        <div className="horizontal-split">
          <div>
            <div className="form-group">
              <label htmlFor="emailInput">Email</label>
              <input
                type="email"
                className="form-control"
                id="emailInput"
                aria-describedby="emailHelp"
                value={this.state.email}
                onChange={this.handleEmailChange}
              />
            </div>
            <div className="form-group">
              <label htmlFor="passwordInput">Contraseña</label>
              <input
                type="password"
                className="form-control"
                id="passwordInput"
                value={this.state.password}
                onChange={this.handlePasswordChange}
              />
            </div>
            <div className="form-group DevicesSelect">
              <select className="form-control" onChange={this.handleDeviceChange}>
                {
                  this.state.deviceOptions.map(deviceInfo => <option key={deviceInfo.name} value={deviceInfo.name}>{this.deviceName(deviceInfo)}</option>)
                }
              </select>
              <img src={RefreshIcon} onClick={this.refreshItems} />
            </div>
            {
              this.state.readerIP
              ? <div>
                  <div className="form-group">
                    <label htmlFor="tokenInput">ID de señal</label>
                    <input
                      type="text"
                      className="form-control"
                      id="tokenInput"
                      value={this.state.signalUUID}
                      disabled
                    />
                  </div>
                  {
                    this.state.started
                    ? <div>
                        <div className="StopCancelButtons">
                          <button className="btn btn-info" onClick={this.stopReading}>Parar</button>
                          <button className="btn btn-danger" onClick={this.cancelReading}>Cancelar</button>
                        </div>
                      </div>
                    : <button className="btn btn-info" onClick={this.startReading}>Comenzar lectura</button>
                  }
                </div>
              : null
            }
          </div>
          <div className="chart-container">
            {
              this.state.readerIP &&
              <div className="ChartWithSliders">
                <div className="SlidersContainer">
                  <CustomSlider value={this.state.settings.windowSize} onChange={this.handleWindowSizeChange} text="Tamaño ventana" max={300} />
                  <CustomSlider value={this.state.settings.spikeThreshold} onChange={this.handleSpikeThresholdChange} text="Umbral de pico" max={1023} />
                  {/* <CustomSlider value={this.state.settings.zeroThreshold} onChange={this.handleZeroThresholdChange} text="Umbral de cero" max={1023} /> */}
                  <CustomSlider value={this.state.settings.zeroLength} onChange={this.handleZeroLengthChange} text="Longitud de cero" />
                </div>
                {
                  this.state.signalUUID &&
                  <CustomChart
                    reading={this.state.started}
                    url={this.state.readerIP}
                    token={this.state.signalUUID}
                  />
                }
              </div>
            }
          </div>
        </div>
        <br/>
        <button
          disabled={!this.state.readyToSend}
          className="btn btn-primary"
          onClick={() => this.props.onSubmit(this.state.email, this.state.password, this.state.signalUUID)}
        >
          {this.props.submitText}
        </button>
        <p className="form-text text-muted">
          {this.props.belowSubmitText1}
          {' '}
          <a className="Link" onClick={this.props.onBelowSubmitClick}>
            {this.props.belowSubmitText2}
          </a>
        </p>
      </div>
    );
  }
}

Form.defaultProps = {
  submitText: 'Enviar',
};

Form.propTypes = {
  externalError: PropTypes.string,
  submitText: PropTypes.string,
  onSubmit: PropTypes.func.isRequired,
  belowSubmitText1: PropTypes.string.isRequired,
  belowSubmitText2: PropTypes.string.isRequired,
  onBelowSubmitClick: PropTypes.func.isRequired,
};

export default Form;
