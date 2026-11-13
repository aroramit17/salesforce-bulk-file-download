import { LightningElement, api } from 'lwc';

export default class FcCrateBuilder extends LightningElement {
    @api recordIds;
    @api listViewId;
    @api objectApiName;
    @api compact;
    @api relatedPaths;
    @api listViews;
    @api presetRows;
    @api presetLabel;
    @api request;
    @api initialOptions;
}
