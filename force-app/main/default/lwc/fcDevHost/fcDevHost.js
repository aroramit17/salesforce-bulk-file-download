import { LightningElement, wire } from 'lwc';
import { CurrentPageReference } from 'lightning/navigation';
export default class FcDevHost extends LightningElement {
    ids = [];
    @wire(CurrentPageReference) ref(r) { if (r && r.state && r.state.c__ids) this.ids = r.state.c__ids.split(','); }
}
