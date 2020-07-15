/* jshint -W097 */
/* jshint strict: false */
/* jslint node: true */
'use strict';

const utils       = require('@iobroker/adapter-core');
const comfo       = require('node-comfoairq/lib/comfoconnect');
const adapterName = require('./package.json').name.split('.').pop();
const util        = require('util');

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

        this.on('ready', this.onReady.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('unload', this.onUnload.bind(this));
    }

    async onReady() {
        const that = this;

        this.setState('info.connection', false, true);

        console.log = function(d) {
            that.log.debug('console.log: ' + util.format(d));
        };

        this.zehnder = new comfo();
        this.zehnder.settings = {
            "pin": parseInt(this.config.pin),
            "uuid" : "20200428000000000000000009080408",
            "device" : "iobroker",
            "multicast": "192.168.1.255",
            "comfoair": this.config.host,
            "debug": true
        };

        this.zehnder.discover();

        this.log.debug('settings: ' + JSON.stringify(this.zehnder.settings));

        this.log.debug('register receive handler...');
        this.zehnder.on('receive', (data) => {
            that.log.debug('received: ' + JSON.stringify(data));
        });

        this.log.debug('register disconnect handler...');
        this.zehnder.on('disconnect', (reason) => {
            if (reason.state == 'OTHER_SESSION') {
                that.log.warn('Other session started');
            }
        });

        this.log.debug('register the app...');
        let result = await this.zehnder.RegisterApp();
        this.log.debug('registerAppResult: ' + JSON.stringify(result));

        this.log.debug('version request...');
        result = await this.zehnder.VersionRequest();
        this.log.debug(JSON.stringify(result));
    }

    onUnload(callback) {
        try {
            //await this.zehnder.CloseSession();
            this.zehnder = null;

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