'use strict';

const utils = require('@iobroker/adapter-core');
const comfoconnect = require('comfoairq');

// null = the ventilation unit announced by the device (node 1 on most setups, but e.g. 45 for a ComfoAir Flex)
const VENTILATION_NODE = null;

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
        this.pendingSensorValues = {};
        this.refreshPropertiesInterval = null;
        this.connectTimeout = null;

        this.sensorMeta = {
            81: { unit: 's' },
            82: { unit: 's' },
            86: { unit: 's' },
            87: { unit: 's' },
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
            212: { unit: '°C' },
            213: { unit: 'W' },
            214: { unit: 'kWh' },
            215: { unit: 'kWh' },
            216: { unit: 'W' },
            217: { unit: 'kWh' },
            218: { unit: 'kWh' },
            219: { unit: 'W' },
            220: { unit: '°C' },
            221: { unit: '°C' },
            227: { unit: '%' },
            274: { unit: '°C' },
            275: { unit: '°C' },
            276: { unit: '°C' },
            277: { unit: '°C' },
            278: { unit: '°C' },
            290: { unit: '%' },
            291: { unit: '%' },
            292: { unit: '%' },
            293: { unit: '%' },
            294: { unit: '%' },
            369: { unit: 'V', factor: 0.1 },
            370: { unit: 'V', factor: 0.1 },
            371: { unit: 'V', factor: 0.1 },
            372: { unit: 'V', factor: 0.1 },
            384: { unit: '°C' },
            400: { unit: '°C' },
            416: { unit: '°C' },
            417: { unit: '°C' },
            418: { unit: '%' },
            802: { unit: '°C' },
        };

        // command.<state> -> command constant of the library
        this.commands = {
            fanModeAway: 'FAN_MODE_AWAY',
            fanModeLow: 'FAN_MODE_LOW',
            fanModeMedium: 'FAN_MODE_MEDIUM',
            fanModeHigh: 'FAN_MODE_HIGH',
            fanBoost10m: 'FAN_BOOST_10M',
            fanBoost20m: 'FAN_BOOST_20M',
            fanBoost30m: 'FAN_BOOST_30M',
            fanBoost60m: 'FAN_BOOST_60M',
            fanBoost90m: 'FAN_BOOST_90M',
            fanBoostUnlimited: 'FAN_BOOST',
            fanBoostEnd: 'FAN_BOOST_END',
            awayEnd: 'AWAY_END',
            modeAuto: 'MODE_AUTO',
            modeManual: 'MODE_MANUAL',
            ventmodeSupply: 'VENTMODE_SUPPLY',
            ventmodeBalance: 'VENTMODE_BALANCE',
            ventmodeExtract: 'VENTMODE_EXTRACT',
            ventmodeExtractOff: 'VENTMODE_EXTRACT_OFF',
            tempprofNormal: 'TEMPPROF_NORMAL',
            tempprofCool: 'TEMPPROF_COOL',
            tempprofWarm: 'TEMPPROF_WARM',
            bypassOn: 'BYPASS_ON',
            bypassOff: 'BYPASS_OFF',
            bypassAuto: 'BYPASS_AUTO',
            filterChangeStart: 'FILTER_CHANGE_START',
            filterChangeComplete: 'FILTER_CHANGE_COMPLETE',
            filterChangeAbort: 'FILTER_CHANGE_ABORT',
            errorsReset: 'ERRORS_RESET',
        };

        // property name of the library -> state definition (created as property.<camelCaseName>)
        const offAutoOn = { 0: 'off', 1: 'auto', 2: 'on' };
        this.propertyMeta = {
            DEVICE_NAME: { type: 'string', role: 'info.name' },
            MODEL_NAME: { type: 'string', role: 'info.model' },
            SERIAL_NUMBER: { type: 'string', role: 'info.serial' },
            FIRMWARE_VERSION: { type: 'string', role: 'info.firmware' },
            ARTICLE_NUMBER: { type: 'string', role: 'text' },
            COUNTRY: { type: 'string', role: 'text' },
            FILTER_LIFETIME: { type: 'number', role: 'level', unit: 'days', write: true },
            FILTER_WARNING: { type: 'number', role: 'level', unit: 'days', write: true },
            FAN_FLOW_AWAY: { type: 'number', role: 'level', unit: 'm³/h', write: true },
            FAN_FLOW_LOW: { type: 'number', role: 'level', unit: 'm³/h', write: true },
            FAN_FLOW_MEDIUM: { type: 'number', role: 'level', unit: 'm³/h', write: true },
            FAN_FLOW_HIGH: { type: 'number', role: 'level', unit: 'm³/h', write: true },
            RMOT_HEATING_LIMIT: { type: 'number', role: 'level.temperature', unit: '°C', write: true },
            RMOT_COOLING_LIMIT: { type: 'number', role: 'level.temperature', unit: '°C', write: true },
            SENSOR_TEMP_PASSIVE: { type: 'number', role: 'level.mode', states: offAutoOn, write: true },
            SENSOR_HUMIDITY_COMFORT: { type: 'number', role: 'level.mode', states: offAutoOn, write: true },
            SENSOR_HUMIDITY_PROTECTION: { type: 'number', role: 'level.mode', states: offAutoOn, write: true },
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

                try {
                    this.zehnder = new comfoconnect({
                        uuid: this.uuid,
                        device: this.deviceName,

                        comfoair: this.config.host,
                        port: Number(this.config.port),
                        comfouuid: String(this.config.uuid).replace(/[^0-9a-f]/gi, ''),
                        pin: parseInt(this.config.pin),

                        debug: false,
                        logger: this.log.debug,
                    });
                } catch (err) {
                    this.log.error(`Invalid instance configuration (check UUID of the LAN C): ${err}`);
                    return;
                }

                this.log.debug('register receive handler...');
                this.zehnder.on('receive', async data => {
                    this.log.debug(`received: ${JSON.stringify(data)}`);

                    if (data && data.result.error == 'OK') {
                        if (data.kind == 40) {
                            // 40 = CnRpdoNotification
                            // receiving sensor values means the session is active (e.g. after a disconnect event without a new StartSessionConfirm)
                            if (!this.connected) {
                                await this.setState('info.connection', { val: true, ack: true });
                                this.connected = true;
                            }

                            await this.updateSensor(data.result.data);
                        } else if (data.kind == 32) {
                            // 32 = CnNodeNotification (nodes on the ComfoNet bus, announced after StartSession)
                            await this.updateNode(data.result.data);
                        } else if (data.kind == 53) {
                            // 53 = StartSessionConfirm (also sent after an automatic reconnect of the library)
                            await this.setState('info.connection', { val: true, ack: true });
                            this.connected = true;
                        }
                    }
                });

                this.log.debug('register alarm handler...');
                this.zehnder.on('alarm', async alarm => {
                    this.log.debug(`alarm: ${JSON.stringify(alarm)}`);
                    await this.updateAlarm(alarm);
                });

                this.log.debug('register disconnect handler...');
                this.zehnder.on('disconnect', reason => {
                    if (reason.state == 'OTHER_SESSION') {
                        this.log.warn(`Other session started: ${JSON.stringify(reason)}`);
                    }

                    this.setState('info.connection', { val: false, ack: true });
                    this.connected = false;
                });

                this.subscribeStates('command.*');
                this.subscribeStates('property.*');

                await this.connect();
            } else {
                this.log.warn('No active sensors found in configuration - stopping');
            }
        } else {
            this.log.warn('Instance configuration incomplete - please check configuration and restart instance');
        }
    }

    /**
     * Starts the session and registers the sensors. Retries every minute until the first session was started -
     * afterwards the library reconnects automatically
     */
    async connect() {
        this.connectTimeout = null;

        try {
            // fails e.g. with a wrong PIN - not required if the app is already registered
            this.log.debug('register the app...');
            await this.zehnder.RegisterApp();
        } catch (err) {
            this.log.debug(`Unable to register the app: ${err}`);
        }

        try {
            this.log.debug('startSession');
            const startSessionResult = await this.zehnder.StartSession(true);
            this.log.debug(`startSessionResult: ${JSON.stringify(startSessionResult)}`);

            for (const sensor of this.sensors) {
                await this.zehnder.RegisterSensor(sensor);
                this.log.debug(`Registered sensor "${sensor}"`);
            }
        } catch (err) {
            if (err?.code === 'NOT_ALLOWED') {
                this.log.error(
                    `Unable to start session - app is not registered at the LAN C, please check the PIN: ${err}`,
                );
                return;
            }

            this.log.warn(`Unable to start session (retry in 60 seconds): ${err}`);
            this.connectTimeout = this.setTimeout(() => this.connect(), 60 * 1000);
            return;
        }

        await this.setState('info.connection', { val: true, ack: true });
        this.connected = true;

        try {
            const version = await this.zehnder.VersionRequest();
            this.log.debug(`version: ${JSON.stringify(version)}`);

            await this.setState('version.comfonet', { val: version.comfoNetVersion, ack: true });
            await this.setState('version.serial', { val: version.serialNumber, ack: true });
            await this.setState('version.gateway', { val: version.gatewayVersion, ack: true });
        } catch (err) {
            this.log.warn(`Unable to read version: ${err}`);
        }

        await this.refreshProperties();
        this.refreshPropertiesInterval = this.setInterval(() => this.refreshProperties(), 60 * 60 * 1000);
    }

    /**
     * Creates / updates sensor.<camelCaseName> of a CnRpdoNotification
     *
     * @param {{ pdid: number, name: string, data: number | boolean | string[] | null | Buffer }} sensor decoded sensor value of the library
     */
    async updateSensor(sensor) {
        const sensorId = sensor.pdid;
        const meta = this.sensorMeta?.[sensorId];

        if (!sensor.name) {
            return;
        }

        const id = `sensor.${this.cleanNamespace(sensor.name.replace('SENSOR', ''))}`;
        const name = `${sensor.name} (${sensorId})`;

        if (typeof sensor.data === 'boolean') {
            await this.createReadOnlyState(id, name, 'boolean', 'indicator', undefined, { sensorId });
            await this.setSensorValue(sensorId, id, sensor.data);
        } else if (typeof sensor.data === 'number') {
            const value = meta?.factor ? Math.round(sensor.data * meta.factor * 1000) / 1000 : sensor.data;

            await this.createReadOnlyState(id, name, 'number', 'value', meta?.unit, { sensorId });
            await this.setSensorValue(sensorId, id, value);
        } else if (Array.isArray(sensor.data) || sensor.data === null) {
            // e.g. list of active airflow constraints (null = not available)
            await this.createReadOnlyState(id, name, 'string', 'text', undefined, { sensorId });
            await this.setSensorValue(sensorId, id, sensor.data ? sensor.data.join(', ') : null);
        }
        // otherwise unknown format (raw buffer)
    }

    /**
     * Creates / updates node.<nodeId>.* of a CnNodeNotification
     *
     * @param {{ nodeId: number, productId: number, productName: string, zoneId: number, mode: string, offline: boolean }} node node announced by the device
     */
    async updateNode(node) {
        const id = `node.${node.nodeId}`;

        await this.extendObject(id, {
            type: 'channel',
            common: {
                name: `${node.productName} (${node.nodeId})`,
            },
            native: {
                nodeId: node.nodeId,
            },
        });

        await this.createReadOnlyState(`${id}.productId`, 'Product ID', 'number', 'value');
        await this.setState(`${id}.productId`, { val: node.productId, ack: true });

        await this.createReadOnlyState(`${id}.productName`, 'Product name', 'string', 'text');
        await this.setState(`${id}.productName`, { val: node.productName, ack: true });

        await this.createReadOnlyState(`${id}.zone`, 'Zone', 'number', 'value');
        await this.setState(`${id}.zone`, { val: node.zoneId ?? null, ack: true });

        await this.createReadOnlyState(`${id}.mode`, 'Mode', 'string', 'text');
        await this.setState(`${id}.mode`, { val: node.mode, ack: true });

        await this.createReadOnlyState(`${id}.online`, 'Online', 'boolean', 'indicator.reachable');
        await this.setState(`${id}.online`, { val: !node.offline, ack: true });
    }

    /**
     * Updates node.<nodeId>.* of a CnAlarmNotification (active errors of a node)
     *
     * @param {{ nodeId: number, serialNumber: string, firmwareVersion: string | null, errors: Record<string, string> }} alarm alarm of the library
     */
    async updateAlarm(alarm) {
        const id = `node.${alarm.nodeId}`;
        const errors = Object.values(alarm.errors || {});

        if (errors.length > 0) {
            this.log.warn(`Node ${alarm.nodeId} reports errors: ${errors.join(', ')}`);
        }

        await this.createReadOnlyState(`${id}.serialNumber`, 'Serial number', 'string', 'info.serial');
        await this.setState(`${id}.serialNumber`, { val: alarm.serialNumber ?? null, ack: true });

        await this.createReadOnlyState(`${id}.firmwareVersion`, 'Firmware version', 'string', 'info.firmware');
        await this.setState(`${id}.firmwareVersion`, { val: alarm.firmwareVersion, ack: true });

        await this.createReadOnlyState(`${id}.errors`, 'Active errors', 'string', 'text');
        await this.setState(`${id}.errors`, { val: errors.join(', '), ack: true });

        await this.createReadOnlyState(`${id}.errorCount`, 'Number of active errors', 'number', 'value');
        await this.setState(`${id}.errorCount`, { val: errors.length, ack: true });
    }

    /**
     * @param {string} id state id
     * @param {string} name state name
     * @param {ioBroker.CommonType} type state type
     * @param {string} role state role
     * @param {string} [unit] state unit
     * @param {Record<string, number>} [native] native part of the object
     */
    async createReadOnlyState(id, name, type, role, unit, native = {}) {
        await this.extendObject(id, {
            type: 'state',
            common: {
                name,
                type,
                role,
                unit,
                read: true,
                write: false,
            },
            native,
        });
    }

    /**
     * Updates a sensor state at most every 2 seconds. Values received in between are not dropped:
     * the latest one is written when the pause ends (e.g. the correct value right after an invalid one)
     *
     * @param {number} sensorId PDID of the sensor
     * @param {string} id state id
     * @param {ioBroker.StateValue} value sensor value
     */
    async setSensorValue(sensorId, id, value) {
        if (Object.prototype.hasOwnProperty.call(this.pausedSensorValues, sensorId)) {
            this.pendingSensorValues[sensorId] = { id, value };
            return;
        }

        await this.setState(id, { val: value, ack: true });

        this.pausedSensorValues[sensorId] = this.setTimeout(async () => {
            delete this.pausedSensorValues[sensorId];

            const pending = this.pendingSensorValues[sensorId];
            if (pending) {
                delete this.pendingSensorValues[sensorId];
                await this.setSensorValue(sensorId, pending.id, pending.value);
            }
        }, 2000);
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

    async refreshProperties() {
        for (const name of Object.keys(this.propertyMeta)) {
            if (!this.connected) {
                return;
            }

            await this.readProperty(name);
        }
    }

    /**
     * Reads a property (with allowed range for writable numbers) and updates property.<camelCaseName>
     *
     * @param {string} name property name of the library, e.g. FILTER_LIFETIME
     * @param {number} [retries] the unit may answer with RMI_ERROR right after a write
     */
    async readProperty(name, retries = 0) {
        const meta = this.propertyMeta[name];
        const id = `property.${this.cleanNamespace(name)}`;

        try {
            const common = {
                name: name,
                type: meta.type,
                role: meta.role,
                unit: meta.unit,
                states: meta.states,
                read: true,
                write: !!meta.write,
            };

            let value;
            if (meta.write && meta.type === 'number' && !meta.states) {
                const range = await this.zehnder.GetPropertyRange(VENTILATION_NODE, name);
                this.log.debug(`[property] ${name}: ${JSON.stringify(range)}`);

                value = range.value;
                common.min = range.min;
                common.max = range.max;
                common.step = range.step;
            } else {
                value = await this.zehnder.GetProperty(VENTILATION_NODE, name);
                this.log.debug(`[property] ${name}: ${JSON.stringify(value)}`);
            }

            await this.extendObject(id, {
                type: 'state',
                common: common,
                native: {
                    property: name,
                },
            });
            await this.setState(id, { val: value, ack: true });
        } catch (err) {
            if (retries > 0) {
                await this.delay(1000);
                return this.readProperty(name, retries - 1);
            }
            this.log.warn(`[property] Unable to read ${name}: ${err}`);
        }
    }

    /**
     * Is called if a subscribed state changes
     *
     * @param {string} id
     * @param {ioBroker.State | null | undefined} state
     */
    async onStateChange(id, state) {
        if (id && state && !state.ack) {
            this.log.debug(`state ${id} changed: ${state.val} (ack = ${state.ack})`);

            if (!this.connected) {
                this.log.warn(`Unable to process ${id} - not connected`);
                return;
            }

            const idNoNamespace = this.removeNamespace(id);

            try {
                if (idNoNamespace.startsWith('command.')) {
                    const command = idNoNamespace.substring(8);

                    if (command === 'boostDuration' || command === 'awayDuration') {
                        // duration in minutes, < 0 = unlimited
                        const minutes = Number(state.val);
                        const seconds = minutes < 0 ? -1 : Math.round(minutes * 60);

                        if (command === 'boostDuration') {
                            this.log.debug(`Sending boost for ${seconds} seconds`);
                            await this.zehnder.SetBoost(VENTILATION_NODE, seconds);
                        } else {
                            this.log.debug(`Sending away for ${seconds} seconds`);
                            await this.zehnder.SetAway(VENTILATION_NODE, seconds);
                        }

                        await this.setState(idNoNamespace, { val: minutes, ack: true });
                    } else if (this.commands[command]) {
                        this.log.debug(`Sending command: ${this.commands[command]}`);
                        await this.zehnder.SendCommand(VENTILATION_NODE, this.commands[command]);
                    }
                } else if (idNoNamespace.startsWith('property.')) {
                    const obj = await this.getObjectAsync(idNoNamespace);
                    const name = obj?.native?.property;

                    if (name && this.propertyMeta[name]?.write) {
                        this.log.debug(`Setting property ${name} to ${state.val}`);
                        await this.zehnder.SetProperty(VENTILATION_NODE, name, Number(state.val));
                        await this.delay(1000);
                        await this.readProperty(name, 3);
                    }
                }
            } catch (err) {
                this.log.warn(`Unable to process ${idNoNamespace}: ${err}`);
            }
        }
    }

    removeNamespace(id) {
        const re = new RegExp(`^${this.namespace}\\.`, 'g');
        return id.replace(re, '');
    }

    async onMessage(msg) {
        if (typeof msg === 'object' && msg.message) {
            if (msg.command === 'wizard') {
                const host = String(msg.message.host || '').trim();
                const port = Number(msg.message.port) || undefined;

                this.log.debug(
                    `[onMessage] wizard started on all interfaces${host ? ` and ${host}` : ''} (port ${port}) -> ${JSON.stringify(msg)}`,
                );

                let response;
                try {
                    // Broadcast on all interfaces - and unicast to the configured host (e.g. other subnet / docker)
                    const searches = [comfoconnect.discover({ port, timeout: 5000 })];
                    if (host) {
                        searches.push(comfoconnect.discover({ address: host, port, timeout: 5000 }));
                    }

                    const devices = [];
                    for (const device of (await Promise.all(searches)).flat()) {
                        if (!devices.some(d => d.comfouuid === device.comfouuid)) {
                            devices.push(device);
                        }
                    }

                    // Prefer the configured host
                    devices.sort((a, b) => Number(b.comfoair === host) - Number(a.comfoair === host));

                    this.log.info(
                        `[discovery] Device discovery finished - found ${devices.length} device(s): ${JSON.stringify(devices)}`,
                    );

                    if (devices.length > 0) {
                        if (devices.length > 1) {
                            this.log.warn(
                                `[discovery] Found multiple devices - using ${devices[0].comfoair}, check log for other devices`,
                            );
                        }

                        response = {
                            native: {
                                host: devices[0].comfoair,
                                uuid: devices[0].comfouuid,
                            },
                            saveConfig: false,
                            error: null,
                        };
                    } else {
                        response = { saveConfig: false, error: 'No device found' };
                    }
                } catch (err) {
                    this.log.error(`[discovery] error: ${err}`);
                    response = { saveConfig: false, error: String(err) };
                }

                if (msg.callback) {
                    this.sendTo(msg.from, msg.command, response, msg.callback);
                }
            }
        }
    }

    onUnload(callback) {
        try {
            for (const [sensorId, timeout] of Object.entries(this.pausedSensorValues)) {
                this.log.debug(`Removing timeout for sensor ${sensorId}`);
                this.clearTimeout(timeout);
            }

            if (this.refreshPropertiesInterval) {
                this.clearInterval(this.refreshPropertiesInterval);
                this.refreshPropertiesInterval = null;
            }

            if (this.connectTimeout) {
                this.clearTimeout(this.connectTimeout);
                this.connectTimeout = null;
            }

            if (this.zehnder) {
                this.zehnder.CloseSession().catch(() => {});
                this.zehnder = null;
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
