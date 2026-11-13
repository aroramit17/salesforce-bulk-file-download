import { LightningElement, api } from 'lwc';

export default class FcCrateBuilder extends LightningElement {
    @api recordIds;
    @api listViewId;
    @api objectApiName;
    @api compact;
}
