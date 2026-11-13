import { LightningElement } from 'lwc';
import getObjects from '@salesforce/apex/FcRecordService.getObjects';
import getListViews from '@salesforce/apex/FcRecordService.getListViews';
import { LABELS } from 'c/fcLabels';

function errorText(e) {
    return (e && e.body && e.body.message) || (e && e.message) || String(e);
}

/** FileCrate tab: pick an object and a list view, then download the files on its records. */
export default class FcCrateTab extends LightningElement {
    labels = LABELS;
    objects = [];
    listViews = [];
    objectApiName = null;
    listViewId = null;
    errorMessage = null;
    listViewsLoaded = false;

    connectedCallback() {
        this.load(async () => {
            this.objects = await getObjects();
        });
    }

    async load(work) {
        this.errorMessage = null;
        try {
            await work();
        } catch (e) {
            this.errorMessage = this.labels.Error + ' ' + errorText(e);
        }
    }

    handleObject(event) {
        const chosen = event.detail.value;
        this.objectApiName = chosen;
        this.listViewId = null;
        this.listViews = [];
        this.listViewsLoaded = false;
        this.load(async () => {
            const views = await getListViews({ objectApiName: chosen });
            if (this.objectApiName === chosen) {
                this.listViews = views;
                this.listViewsLoaded = true;
            }
        });
    }

    handleListView(event) {
        this.listViewId = event.detail.value;
    }

    get noListViews() {
        return this.listViewsLoaded && !this.listViews.length;
    }

    get listViewDisabled() {
        return !this.listViews.length;
    }
}
