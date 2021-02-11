/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
'use strict';

const utils        = require('@iobroker/adapter-core');
const comfoconnect = require('comfoairq');
const adapterName  = require('./package.json').name.split('.').pop();

class Comfoairq extends utils.Adapter {

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: adapterName,
        });

        this.connected = false;

        this.uuid = '20200428000000000000000009080408';
        this.deviceName = 'iobroker';

        this.zehnder = null;
        this.sensors = [];

        this.sensorUnits = {
            117: '%',
            118: '%',
            119: 'm³/h',
            120: 'm³/h',
            121: 'rpm',
            122: 'rpm',
            128: 'W',
            129: 'kWh',
            130: 'kWh',
            144: 'kWh',
            145: 'kWh',
            146: 'W',
            192: 'days',
            209: '°C',
            213: 'W',
            214: 'kWh',
            215: 'kWh',
            216: 'W',
            217: 'kWh',
            218: 'kWh',
            221: '°C',
            227: '%',
            274: '°C',
            275: '°C',
            276: '°C',
            290: '%',
            291: '%',
            292: '%',
            294: '%'
        };

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        this.setState('info.connection', false, true);

        // Get active sensors by configuration
        for (const key of Object.keys(this.config)) {
            if (key.indexOf('sensor_') === 0 && this.config[key]) {
                this.sensors.push(Number(key.slice(7)));
            }
        }

        /*
        this.getForeignObjectAsync('system.adapter.' + this.namespace).then(data => {
            this.log.debug('Current configuration: ' + JSON.stringify(data));
        });
        */

        if (this.config.host && this.config.port && this.config.uuid) {
            if (this.sensors.length > 0) {
                this.log.debug('Active sensors by configuration: ' + JSON.stringify(this.sensors));

                this.zehnder = new comfoconnect(
                    {
                        'uuid' : this.uuid,
                        'device' : this.deviceName,

                        'comfoair': this.config.host,
                        'port': Number(this.config.port),
                        'comfouuid': this.config.uuid,
                        'pin': parseInt(this.config.pin),

                        'debug': false,
                        'logger': this.log.debug
                    }
                );

                this.log.debug('register receive handler...');
                this.zehnder.on('receive', async (data) => {
                    this.log.debug('received: ' + JSON.stringify(data));

                    if (data && data.result.error == 'OK') {
                        if (data.kind == 40) { // 40 = CnRpdoNotification
                            const sensorId = data.result.data.pdid;
                            const sensorName = data.result.data.name;
                            const sensorNameClean = this.cleanNamespace(sensorName.replace('SENSOR', ''));
                            const sensorValue = data.result.data.data;
                            const unit = Object.prototype.hasOwnProperty.call(this.sensorUnits, sensorId) ? this.sensorUnits[sensorId] : '';

                            await this.setObjectNotExistsAsync('sensor.' + sensorNameClean, {
                                type: 'state',
                                common: {
                                    name: sensorName + ' (' + sensorId + ')',
                                    type: 'string',
                                    role: 'value',
                                    unit: unit,
                                    read: true,
                                    write: false
                                },
                                native: {}
                            });
                            this.setState('sensor.' + sensorNameClean, {val: sensorValue, ack: true});

                        } else if (data.kind == 68) { // 68 = VersionConfirm
                            this.setState('version.comfonet', {val: data.result.data.comfoNetVersion, ack: true});
                            this.setState('version.serial', {val: data.result.data.serialNumber, ack: true});
                            this.setState('version.gateway', {val: data.result.data.gatewayVersion, ack: true});
                        }
                    }
                });

                this.log.debug('register disconnect handler...');
                this.zehnder.on('disconnect', (reason) => {
                    if (reason.state == 'OTHER_SESSION') {
                        this.log.warn('Other session started: ' + JSON.stringify(reason));
                    }

                    this.setState('info.connection', false, true);
                });

                this.log.debug('register the app...');
                const registerAppResult = await this.zehnder.RegisterApp();
                this.log.debug('registerAppResult: ' + JSON.stringify(registerAppResult));

                // Start the session
                this.log.debug('startSession');
                const startSessionResult = await this.zehnder.StartSession(true);
                this.log.debug('startSessionResult:' + JSON.stringify(startSessionResult));

                for (let i = 0; i < this.sensors.length; i++) {
                    const registerResult = await this.zehnder.RegisterSensor(this.sensors[i]);
                    this.log.debug('Registered sensor "' + this.sensors[i] + '" with result: ' + JSON.stringify(registerResult));
                }

                this.zehnder.VersionRequest();

                this.setState('info.connection', true, true);
                this.connected = true;
                this.subscribeStates('*');
            } else {
                this.log.warn('No active sensors found in configuration - stopping');
            }
        } else {
            // Dicover Zehnder devices
            this.log.warn('Device information not configured - starting discovery');

            this.zehnder = new comfoconnect(
                {
                    'uuid' : this.uuid,
                    'device' : this.deviceName,
                    'port': Number(this.config.port),
                    'debug': false,
                    'logger': this.log.debug
                }
            );

            try {
                const discoverResult = await this.zehnder.discover('172.16.255.255');
                this.log.info('Device discovery finished: ' + JSON.stringify(discoverResult));
            } catch (ex) {
                this.log.error('error while discovery: ' + JSON.stringify(ex));
            }
        }
    }

    cleanNamespace(id) {
        return id
            .trim()
            .replace(/\s/g, '_') // Replace whitespaces with underscores
            .replace(/[^\p{Ll}\p{Lu}\p{Nd}]+/gu, '_') // Replace not allowed chars with underscore
            .replace(/[_]+$/g, '') // Remove underscores end
            .replace(/^[_]+/g, '') // Remove underscores beginning
            .replace(/_+/g, '_') // Replace multiple underscores with one
            .toLowerCase()
            .replace(/_([a-z])/g, (m, w) => {
                return w.toUpperCase();
            });
    }

    onUnload(callback) {
        try {
            this.zehnder.CloseSession();
            this.zehnder = null;

            this.setState('info.connection', false, true);

            callback();
        } catch (e) {
            callback();
        }
    }

    /**
     * Is called if a subscribed state changes
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (id && state && !state.ack) {
            this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

            if (this.connected) {
                const matches = id.match(new RegExp(this.namespace + '.command.([a-zA-Z0-9]+)'));
                if (matches) {
                    const command = matches[1];

                    switch (command) {

                        case 'fanModeAway':
                            this.log.debug('Sending command: FAN_MODE_AWAY');
                            this.zehnder.SendCommand(1, 'FAN_MODE_AWAY');
                            break;

                        case 'fanModeLow':
                            this.log.debug('Sending command: FAN_MODE_LOW');
                            this.zehnder.SendCommand(1, 'FAN_MODE_LOW');
                            break;

                        case 'fanModeMedium':
                            this.log.debug('Sending command: FAN_MODE_MEDIUM');
                            this.zehnder.SendCommand(1, 'FAN_MODE_MEDIUM');
                            break;

                        case 'fanModeHigh':
                            this.log.debug('Sending command: FAN_MODE_HIGH');
                            this.zehnder.SendCommand(1, 'FAN_MODE_HIGH');
                            break;

                        case 'fanBoost10m':
                            this.log.debug('Sending command: FAN_BOOST_10M');
                            this.zehnder.SendCommand(1, 'FAN_BOOST_10M');
                            break;

                        case 'fanBoost20m':
                            this.log.debug('Sending command: FAN_BOOST_20M');
                            this.zehnder.SendCommand(1, 'FAN_BOOST_20M');
                            break;

                        case 'fanBoost30m':
                            this.log.debug('Sending command: FAN_BOOST_30M');
                            this.zehnder.SendCommand(1, 'FAN_BOOST_30M');
                            break;

                        case 'fanBoostEnd':
                            this.log.debug('Sending command: FAN_BOOST_END');
                            this.zehnder.SendCommand(1, 'FAN_BOOST_END');
                            break;

                        case 'modeAuto':
                            this.log.debug('Sending command: MODE_AUTO');
                            this.zehnder.SendCommand(1, 'MODE_AUTO');
                            break;

                        case 'modeManual':
                            this.log.debug('Sending command: MODE_MANUAL');
                            this.zehnder.SendCommand(1, 'MODE_MANUAL');
                            break;

                        case 'ventmodeSupply':
                            this.log.debug('Sending command: VENTMODE_SUPPLY');
                            this.zehnder.SendCommand(1, 'VENTMODE_SUPPLY');
                            break;

                        case 'ventmodeBalance':
                            this.log.debug('Sending command: VENTMODE_BALANCE');
                            this.zehnder.SendCommand(1, 'VENTMODE_BALANCE');
                            break;

                        case 'tempprofNormal':
                            this.log.debug('Sending command: TEMPPROF_NORMAL');
                            this.zehnder.SendCommand(1, 'TEMPPROF_NORMAL');
                            break;

                        case 'tempprofCool':
                            this.log.debug('Sending command: TEMPPROF_COOL');
                            this.zehnder.SendCommand(1, 'TEMPPROF_COOL');
                            break;

                        case 'tempprofWarm':
                            this.log.debug('Sending command: TEMPPROF_WARM');
                            this.zehnder.SendCommand(1, 'TEMPPROF_WARM');
                            break;

                        case 'bypassOn':
                            this.log.debug('Sending command: BYPASS_ON');
                            this.zehnder.SendCommand(1, 'BYPASS_ON');
                            break;

                        case 'bypassOff':
                            this.log.debug('Sending command: BYPASS_OFF');
                            this.zehnder.SendCommand(1, 'BYPASS_OFF');
                            break;

                        case 'bypassAuto':
                            this.log.debug('Sending command: BYPASS_AUTO');
                            this.zehnder.SendCommand(1, 'BYPASS_AUTO');
                            break;

                    }
                }
            }
        }
    }
}

// @ts-ignore parent is a valid property on module
if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    module.exports = (options) => new Comfoairq(options);
} else {
    // otherwise start the instance directly
    new Comfoairq();
}