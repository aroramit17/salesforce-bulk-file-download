import { LightningElement } from 'lwc';
import getJobs from '@salesforce/apex/FcJobService.getJobs';
import { formatBytes } from 'c/fcCore';
import { LABELS } from 'c/fcLabels';

function errorText(e) {
    return (e && e.body && e.body.message) || (e && e.message) || String(e);
}

/** The last 50 FileCrate runs this user may see, each with a "Run again" action. */
export default class FcJobHistory extends LightningElement {
    labels = LABELS;
    rows = null;
    errorMessage = null;

    columns = [
        { label: LABELS.Col_Job, fieldName: 'name' },
        { label: LABELS.Col_When, fieldName: 'createdDate', type: 'date', typeAttributes: { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' } },
        { label: LABELS.Col_Source, fieldName: 'sourceLabel' },
        { label: LABELS.Object, fieldName: 'objectApiName' },
        { label: LABELS.Col_Files, fieldName: 'fileCount', type: 'number' },
        { label: LABELS.Col_Size, fieldName: 'sizeText' },
        { label: LABELS.Col_Destination, fieldName: 'destinationLabel' },
        { label: LABELS.Col_Status, fieldName: 'statusLabel' },
        { label: LABELS.Col_By, fieldName: 'createdByName' },
        { type: 'action', typeAttributes: { rowActions: [{ label: LABELS.Rerun, name: 'rerun' }] } }
    ];

    connectedCallback() {
        this.load();
    }

    async load() {
        try {
            const jobs = await getJobs();
            // Stored values are short codes; show the translated word when there is one.
            const word = (prefix, value) => this.labels[prefix + value] || value;
            this.rows = (jobs || []).map((job) => ({
                ...job,
                sizeText: formatBytes(job.totalBytes || 0),
                sourceLabel: word('Src_', job.sourceType),
                statusLabel: word('Status_', job.status),
                destinationLabel: word('Dest_', job.destination)
            }));
        } catch (e) {
            this.errorMessage = this.labels.Error + ' ' + errorText(e);
        }
    }

    handleRowAction(event) {
        if (event.detail.action.name !== 'rerun') {
            return;
        }
        const job = this.rows.find((row) => row.id === event.detail.row.id);
        let request;
        try {
            request = JSON.parse(job.request);
        } catch (e) {
            return;
        }
        if (request && typeof request === 'object' && request.mode) {
            this.dispatchEvent(new CustomEvent('rerun', { detail: { request } }));
        }
    }

    get hasJobs() {
        return Array.isArray(this.rows) && this.rows.length > 0;
    }
    get isEmpty() {
        return Array.isArray(this.rows) && this.rows.length === 0;
    }
}
