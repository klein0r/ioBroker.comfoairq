'use strict';

const utils = require('@iobroker/adapter-core');
const comfoconnect = require('comfoairq');
const adapterName = require('./package.json').name.split('.').pop();

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

        this.pausedSensorValues = {};
        this.lastSensorValues = {};
        this.sensorMeta = {
            117: { unit: '%' },
            118: { unit: '%' },
            119: { unit: 'm³/h' },
            120: { unit: 'm³/h' },
            121: { unit: 'rpm' },
            122: { unit: 'rpm' },
            128: { unit: 'W' },
            129: { unit: 'kWh' },
            130: { unit: 'kWh' },
            144: { unit: 'kWh' },
            145: { unit: 'kWh' },
            146: { unit: 'W' },
            192: { unit: 'days' },
            209: { unit: '°C' },
            213: { unit: 'W' },
            214: { unit: 'kWh' },
            215: { unit: 'kWh' },
            216: { unit: 'W' },
            217: { unit: 'kWh' },
            218: { unit: 'kWh' },
            221: { unit: '°C' },
            227: { unit: '%' },
            274: { unit: '°C' },
            275: { unit: '°C' },
            276: { unit: '°C' },
            290: { unit: '%' },
            291: { unit: '%' },
            292: { unit: '%' },
            294: { unit: '%' },
        };

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        await this.setStateAsync('info.connection', false, true);

        // Get active sensors by configuration
        for (const key of Object.keys(this.config)) {
            if (key.startsWith('sensor_') && this.config[key]) {
                this.sensors.push(Number(key.substring(7)));
            }
        }

        if (this.config.host && this.config.port && this.config.uuid && this.config.pin) {
            if (this.sensors.length > 0) {
                this.log.debug(`Active sensors by configuration: ${JSON.stringify(this.sensors)}`);

                this.zehnder = new comfoconnect({
                    uuid: this.uuid,
                    device: this.deviceName,

                    comfoair: this.config.host,
                    port: Number(this.config.port),
                    comfouuid: this.config.uuid,
                    pin: parseInt(this.config.pin),

                    debug: false,
                    logger: this.log.debug,
                });

                this.log.debug('register receive handler...');
                this.zehnder.on('receive', async (data) => {
                    this.log.debug(`received: ${JSON.stringify(data)}`);

                    if (data && data.result.error == 'OK') {
                        if (data.kind == 40) {
                            // 40 = CnRpdoNotification
                            const sensorId = data.result.data.pdid;
                            const sensorName = data.result.data.name;
                            const sensorNameClean = this.cleanNamespace(sensorName.replace('SENSOR', ''));
                            const sensorValue = data.result.data.data;

                            if (!isNaN(sensorValue)) {
                                await this.extendObjectAsync(`sensor.${sensorNameClean}`, {
                                    type: 'state',
                                    common: {
                                        name: `${sensorName} (${sensorId})`,
                                        type: 'number',
                                        role: 'value',
                                        unit: this.sensorMeta?.[sensorId]?.unit,
                                        read: true,
                                        write: false,
                                    },
                                    native: {
                                        sensorId: sensorId,
                                    },
                                });

                                if (!Object.keys(this.pausedSensorValues).includes(sensorId)) {
                                    await this.setStateChangedAsync(`sensor.${sensorNameClean}`, { val: sensorValue, ack: true });

                                    this.pausedSensorValues[sensorId] = this.setTimeout(() => {
                                        if (this.lastSensorValues?.[sensorId]) {
                                            this.log.debug(`updating sensor value ${sensorId} from cache: ${this.lastSensorValues[sensorId]}`);

                                            this.setStateChanged(`sensor.${sensorNameClean}`, { val: this.lastSensorValues[sensorId], ack: true, c: 'cached' });
                                            delete this.lastSensorValues[sensorId];
                                        }
                                        delete this.pausedSensorValues[sensorId];
                                    }, 2000);
                                } else {
                                    this.lastSensorValues[sensorId] = sensorValue;
                                }
                            }
                        } else if (data.kind == 68) {
                            // 68 = VersionConfirm
                            await this.setStateChangedAsync('version.comfonet', { val: data.result.data.comfoNetVersion.toString(), ack: true });
                            await this.setStateChangedAsync('version.serial', { val: data.result.data.serialNumber.toString(), ack: true });
                            await this.setStateChangedAsync('version.gateway', { val: data.result.data.gatewayVersion.toString(), ack: true });
                        }
                    }
                });

                this.log.debug('register disconnect handler...');
                this.zehnder.on('disconnect', (reason) => {
                    if (reason.state == 'OTHER_SESSION') {
                        this.log.warn(`Other session started: ${JSON.stringify(reason)}`);
                    }

                    this.setState('info.connection', { val: false, ack: true} );
                    this.connected = false;
                });

                this.log.debug('register the app...');
                const registerAppResult = await this.zehnder.RegisterApp();
                this.log.debug(`registerAppResult: ${JSON.stringify(registerAppResult)}`);

                // Start the session
                this.log.debug('startSession');
                const startSessionResult = await this.zehnder.StartSession(true);
                this.log.debug(`startSessionResult: ${JSON.stringify(startSessionResult)}`);

                for (const sensor of this.sensors) {
                    const registerResult = await this.zehnder.RegisterSensor(sensor);
                    this.log.debug(`Registered sensor "${sensor}" with result: ${JSON.stringify(registerResult)}`);
                }

                this.zehnder.VersionRequest();

                await this.setStateAsync('info.connection', { val: true, ack: true });
                this.connected = true;

                this.subscribeStates('*');
            } else {
                this.log.warn('No active sensors found in configuration - stopping');
            }
        } else if (this.config.multicastAddr && this.config.port) {
            // Dicover Zehnder devices
            this.log.info(`[discovery] Device information not configured - starting discovery on ${this.config.multicastAddr}`);

            this.zehnder = new comfoconnect({
                uuid: this.uuid,
                device: this.deviceName,

                port: Number(this.config.port),

                debug: false,
                logger: this.log.debug,
            });

            try {
                const discoverResult = await this.zehnder.discover(this.config.multicastAddr);
                this.log.info(`[discovery] Device discovery finished - use these information for instance configuration: ${JSON.stringify(discoverResult)}`);
            } catch (err) {
                this.log.error(`[discovery] error: ${JSON.stringify(err)}`);
            }
        } else {
            this.log.error('Instance configuration invalid');
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

            this.setStateAsync('info.connection', { val: false, ack: true });
            this.connected = false;

            callback();
        } catch (err) {
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
