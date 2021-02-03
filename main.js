/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
'use strict';

const utils        = require('@iobroker/adapter-core');
const comfoconnect = require('node-comfoairq');
const adapterName  = require('./package.json').name.split('.').pop();
const util         = require('util');

class Comfoairq extends utils.Adapter {

    /**
     * @param {Partial<utils.AdapterOptions>} [options={}]
     */
    constructor(options) {
        super({
            ...options,
            name: adapterName,
        });

        this.zehnder = null;
        this.sensors = [];

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

        if (this.sensors.length > 0) {
            this.log.debug('Active sensors by configuration: ' + JSON.stringify(this.sensors));

            this.zehnder = new comfoconnect(
                {
                    "pin": parseInt(this.config.pin),
                    "uuid" : "20200428000000000000000009080408",
                    "device" : "iobroker",
                    "multicast": "172.16.255.255",
                    "comfoair": this.config.host,
                    "comfouuid": this.config.uuid,
                    "debug": false,
                    "logger": this.log.debug
                }
            );

            this.log.debug('register receive handler...');
            this.zehnder.on('receive', async (data) => {
                this.log.debug('received: ' + JSON.stringify(data));

                // 40 = CnRpdoNotification
                if (data && data.kind == 40 && data.result.error == 'OK') {
                    const sensorId = data.result.data.pdid;
                    const sensorName = data.result.data.name;
                    const sensorNameClean = this.cleanNamespace(sensorName.replace('SENSOR', ''));
                    const sensorValue = data.result.data.data;

                    await this.setObjectNotExistsAsync('sensor.' + sensorNameClean, {
                        type: 'state',
                        common: {
                            name: sensorName + ' (' + sensorId + ')',
                            type: 'string',
                            role: 'value',
                            read: true,
                            write: false
                        },
                        native: {}
                    });
                    this.setState('sensor.' + sensorNameClean, {val: sensorValue, ack: true});
                }
            });

            this.log.debug('register disconnect handler...');
            this.zehnder.on('disconnect', (reason) => {
                if (reason.state == 'OTHER_SESSION') {
                    this.log.warn('Other session started: ' + JSON.stringify(reason));
                    this.setState('info.connection', false, true);
                }
            });

            this.log.debug('register the app...');
            let registerAppResult = await this.zehnder.RegisterApp();
            this.log.debug('registerAppResult: ' + JSON.stringify(registerAppResult));

            // Start the session
            this.log.debug('startSession');
            const startSessionResult = await this.zehnder.StartSession(true);
            this.log.debug('startSessionResult:' + JSON.stringify(startSessionResult));

            for (let i = 0; i < this.sensors.length; i++) {
                let registerResult = await this.zehnder.RegisterSensor(this.sensors[i]);
                this.log.debug('Registered sensor "' + this.sensors[i] + '" with result: ' + JSON.stringify(registerResult));
            }

            this.setState('info.connection', true, true);
        } else {
            this.log.error('No active sensors found in configuration - stopping');
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
        if (state) {
            // The state was changed
            this.log.info(`state ${id} changed: ${state.val} (ack = ${state.ack})`);
        } else {
            // The state was deleted
            this.log.info(`state ${id} deleted`);
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