import { LightningElement } from 'lwc';
import getStatus from '@salesforce/apex/FcSetupService.getStatus';
import { isEngineMessage, makeNonce } from 'c/fcCore';
import { LABELS } from 'c/fcLabels';

const API_CHECK_TIMEOUT_MS = 15000;

function errorText(e) {
    return (e && e.body && e.body.message) || (e && e.message) || String(e);
}

/** Admin page: current settings, storage use, and whether this user can reach what FileCrate needs. */
export default class FcSetup extends LightningElement {
    labels = LABELS;
    status = null;
    errorMessage = null;
    apiState = 'checking'; // checking | ok | failed

    _nonce = makeNonce();
    engineUrl = '/apex/FcEngine?fc=' + this._nonce;
    _timer = null;
    _onMessage = (event) => this.handleMessage(event);

    connectedCallback() {
        window.addEventListener('message', this._onMessage);
        // eslint-disable-next-line @lwc/lwc/no-async-operation
        this._timer = setTimeout(() => {
            if (this.apiState === 'checking') {
                this.apiState = 'failed';
            }
        }, API_CHECK_TIMEOUT_MS);
        this.load();
    }

    disconnectedCallback() {
        window.removeEventListener('message', this._onMessage);
        clearTimeout(this._timer);
    }

    async load() {
        try {
            this.status = await getStatus();
        } catch (e) {
            this.errorMessage = this.labels.Error + ' ' + errorText(e);
        }
    }

    handleMessage(event) {
        const data = event.data;
        const frame = this.template.querySelector('iframe');
        if (!data || data.fc !== 1 || data.nonce !== this._nonce || !frame) {
            return;
        }
        const trusted = isEngineMessage({
            host: window.location.host,
            origin: event.origin,
            sourceMatches: event.source === frame.contentWindow
        });
        if (!trusted) {
            return;
        }
        if (data.type === 'ready') {
            frame.contentWindow.postMessage({ fc: 1, type: 'ping', requestId: 'ping' }, event.origin);
        } else if (data.type === 'pong') {
            clearTimeout(this._timer);
            this.apiState = data.ok ? 'ok' : 'failed';
        }
    }

    get settingRows() {
        const s = this.status.settings || {};
        return [
            ['maxFilesPerZip', this.labels.Set_MaxFiles],
            ['maxZipMb', this.labels.Set_MaxZip],
            ['includeAttachments', this.labels.Set_Attachments],
            ['includeNotes', this.labels.Set_Notes],
            ['latestVersionOnly', this.labels.Set_Latest],
            ['namePattern', this.labels.Set_Pattern],
            ['folderLayout', this.labels.Set_Layout]
        ].map(([key, label]) => ({
            key,
            labelKey: key + '-label',
            dataId: 'setting-' + key,
            label,
            value: typeof s[key] === 'boolean' ? this.yesNo(s[key]) : String(s[key])
        }));
    }

    yesNo(value) {
        return value ? this.labels.Yes : this.labels.No;
    }

    storageText(storage) {
        return storage && storage.maxMb !== null && storage.maxMb !== undefined
            ? storage.usedMb + ' MB / ' + storage.maxMb + ' MB'
            : '';
    }

    get fileStorageText() {
        return this.storageText(this.status.fileStorage);
    }
    get dataStorageText() {
        return this.storageText(this.status.dataStorage);
    }
    get apiText() {
        if (this.apiState === 'ok') {
            return this.labels.Api_Ok;
        }
        return this.apiState === 'failed' ? this.labels.Api_Failed : this.labels.Checking;
    }
    get soqlText() {
        return this.yesNo(this.status.canRunSoql);
    }
    get eventLogText() {
        return this.yesNo(this.status.canReadEventLogs);
    }
}
