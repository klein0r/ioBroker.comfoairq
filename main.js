'use strict';

const utils = require('@iobroker/adapter-core');
const comfoconnect = require('comfoairq');

class Comfoairq extends utils.Adapter {
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    constructor(options) {
        super({
            ...options,
            name: 'comfoairq',
        });

        this.connected = false;

        this.uuid = '20200428000000000000000009080408';
        this.deviceName = 'iobroker';

        this.zehnder = null;
        this.sensors = [];

        this.pausedSensorValues = {};
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
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        await this.setState('info.connection', false, true);

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
                this.zehnder.on('receive', async data => {
                    this.log.debug(`received: ${JSON.stringify(data)}`);

                    if (data && data.result.error == 'OK') {
                        if (data.kind == 40) {
                            // 40 = CnRpdoNotification
                            const sensorId = data.result.data.pdid;
                            const sensorName = data.result.data.name;
                            const sensorNameClean = this.cleanNamespace(sensorName.replace('SENSOR', ''));
                            const sensorValue = data.result.data.data;

                            if (!isNaN(sensorValue)) {
                                await this.extendObject(`sensor.${sensorNameClean}`, {
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

                                if (!Object.prototype.hasOwnProperty.call(this.pausedSensorValues, sensorId)) {
                                    await this.setState(`sensor.${sensorNameClean}`, {
                                        val: sensorValue,
                                        ack: true,
                                    });

                                    this.pausedSensorValues[sensorId] = this.setTimeout(() => {
                                        //this.log.debug(``);
                                        delete this.pausedSensorValues[sensorId];
                                    }, 2000);
                                }
                            }
                        } else if (data.kind == 68) {
                            // 68 = VersionConfirm
                            await this.setState('version.comfonet', {
                                val: data.result.data.comfoNetVersion.toString(),
                                ack: true,
                            });
                            await this.setState('version.serial', {
                                val: data.result.data.serialNumber.toString(),
                                ack: true,
                            });
                            await this.setState('version.gateway', {
                                val: data.result.data.gatewayVersion.toString(),
                                ack: true,
                            });
                        }
                    }
                });

                this.log.debug('register disconnect handler...');
                this.zehnder.on('disconnect', reason => {
                    if (reason.state == 'OTHER_SESSION') {
                        this.log.warn(`Other session started: ${JSON.stringify(reason)}`);
                    }

                    this.setState('info.connection', { val: false, ack: true });
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

                await this.setState('info.connection', { val: true, ack: true });
                this.connected = true;

                this.subscribeStates('*');
            } else {
                this.log.warn('No active sensors found in configuration - stopping');
            }
        } else {
            this.log.warn('Instance configuration incomplete - please check configuration and restart instance');
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

    /**
     * Is called if a subscribed state changes
     *
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    onStateChange(id, state) {
        if (id && state && !state.ack) {
            this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

            if (this.connected) {
                const matches = id.match(new RegExp(`${this.namespace}.command.([a-zA-Z0-9]+)`));
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

    async onMessage(msg) {
        if (typeof msg === 'object' && msg.message) {
            if (msg.command === 'wizard') {
                this.log.debug(
                    `[onMessage] wizard started on ${msg.message.multicastAddr}:${msg.message.port} -> ${JSON.stringify(msg)}`,
                );

                this.zehnder = new comfoconnect({
                    uuid: this.uuid,
                    device: this.deviceName,

                    port: Number(msg.message.port),

                    debug: false,
                    logger: this.log.debug,
                });

                const discoveryTimeout = this.setTimeout(() => {
                    this.wizard = false;

                    this.sendTo(
                        msg.from,
                        msg.command,
                        {
                            saveConfig: false,
                            error: 'timeout',
                        },
                        msg.callback,
                    );

                    this.log.debug('[onMessage] wizard timeout!');
                }, 20000);

                try {
                    const discoverResult = await this.zehnder.discover(msg.message.multicastAddr);
                    this.log.info(
                        `[discovery] Device discovery finished - use these information for instance configuration: ${JSON.stringify(discoverResult)}`,
                    );

                    this.sendTo(
                        msg.from,
                        msg.command,
                        {
                            native: {
                                host: discoverResult.comfoair,
                                uuid: discoverResult.comfouuid,
                            },
                            saveConfig: false,
                            error: null,
                        },
                        msg.callback,
                    );

                    if (discoveryTimeout) {
                        this.clearTimeout(discoveryTimeout);
                    }
                } catch (err) {
                    this.log.error(`[discovery] error: ${JSON.stringify(err)}`);
                }
            }
        }
    }

    onUnload(callback) {
        try {
            this.zehnder.CloseSession();
            this.zehnder = null;

            for (const [sensorId, timeout] of Object.entries(this.pausedSensorValues)) {
                this.log.debug(`Removing timeout for sensor ${sensorId}`);
                this.clearTimeout(timeout);
            }

            this.setState('info.connection', { val: false, ack: true });
            this.connected = false;

            callback();
        } catch {
            callback();
        }
    }
}

if (module.parent) {
    // Export the constructor in compact mode
    /**
     * @param {Partial<utils.AdapterOptions>} [options]
     */
    module.exports = options => new Comfoairq(options);
} else {
    // otherwise start the instance directly
    new Comfoairq();
}
