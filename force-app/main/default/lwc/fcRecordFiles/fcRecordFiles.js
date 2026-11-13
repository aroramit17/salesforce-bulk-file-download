import { LightningElement, api } from 'lwc';

/** Record page component: download every file on the current record. */
export default class FcRecordFiles extends LightningElement {
    @api objectApiName;
    /** Comma separated child relationship paths to offer, set in Lightning App Builder. */
    @api relatedPaths;

    ids = [];
    _recordId;

    @api
    get recordId() {
        return this._recordId;
    }
    set recordId(value) {
        this._recordId = value;
        this.ids = value ? [value] : [];
    }
}
