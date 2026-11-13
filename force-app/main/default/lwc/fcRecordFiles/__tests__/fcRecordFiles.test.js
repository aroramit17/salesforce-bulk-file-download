import { createElement } from 'lwc';
import FcRecordFiles from 'c/fcRecordFiles';

jest.mock('c/fcCrateBuilder');

describe('c-fc-record-files', () => {
    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
    });

    it('hands the current record to the builder in compact mode', async () => {
        const el = createElement('c-fc-record-files', { is: FcRecordFiles });
        el.recordId = '001A';
        el.objectApiName = 'Account';
        document.body.appendChild(el);
        await Promise.resolve();

        const builder = el.shadowRoot.querySelector('c-fc-crate-builder');
        expect(builder.recordIds).toEqual(['001A']);
        expect(builder.objectApiName).toBe('Account');
        expect(builder.compact).toBe(true);
    });

    it('passes the configured related paths to the builder', async () => {
        const el = createElement('c-fc-record-files', { is: FcRecordFiles });
        el.recordId = '001A';
        el.relatedPaths = 'Contacts, Opportunities';
        document.body.appendChild(el);
        await Promise.resolve();
        expect(el.shadowRoot.querySelector('c-fc-crate-builder').relatedPaths).toBe('Contacts, Opportunities');
    });

    it('renders no builder before it knows the record', async () => {
        const el = createElement('c-fc-record-files', { is: FcRecordFiles });
        document.body.appendChild(el);
        await Promise.resolve();
        expect(el.shadowRoot.querySelector('c-fc-crate-builder')).toBeNull();
    });
});
