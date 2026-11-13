import { createElement } from 'lwc';
import FcCrateTab from 'c/fcCrateTab';
import getObjects from '@salesforce/apex/FcRecordService.getObjects';
import getListViews from '@salesforce/apex/FcRecordService.getListViews';
import searchRecords from '@salesforce/apex/FcSelectionService.searchRecords';
import runQuery from '@salesforce/apex/FcSelectionService.runQuery';
import canRunSoql from '@salesforce/apex/FcSelectionService.canRunSoql';
import getDocumentFolders from '@salesforce/apex/FcOrgFileService.getDocumentFolders';
import getDocuments from '@salesforce/apex/FcOrgFileService.getDocuments';
import getLibraries from '@salesforce/apex/FcOrgFileService.getLibraries';
import getLibraryFiles from '@salesforce/apex/FcOrgFileService.getLibraryFiles';
import getStaticResources from '@salesforce/apex/FcOrgFileService.getStaticResources';
import getEventLogFiles from '@salesforce/apex/FcOrgFileService.getEventLogFiles';

jest.mock('c/fcCrateBuilder');
jest.mock('c/fcJobHistory');
jest.mock('@salesforce/apex/FcRecordService.getObjects', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcRecordService.getListViews', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcSelectionService.searchRecords', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcSelectionService.runQuery', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcSelectionService.canRunSoql', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcOrgFileService.getDocumentFolders', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcOrgFileService.getDocuments', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcOrgFileService.getLibraries', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcOrgFileService.getLibraryFiles', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcOrgFileService.getStaticResources', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcOrgFileService.getEventLogFiles', () => ({ default: jest.fn() }), { virtual: true });

const flush = async () => {
    for (let i = 0; i < 8; i++) {
        // eslint-disable-next-line no-await-in-loop
        await Promise.resolve();
    }
};

async function mount() {
    const el = createElement('c-fc-crate-tab', { is: FcCrateTab });
    document.body.appendChild(el);
    await flush();
    return el;
}

const q = (el, id) => el.shadowRoot.querySelector('[data-id="' + id + '"]');
const builder = (el) => el.shadowRoot.querySelector('c-fc-crate-builder');

async function choose(el, id, value) {
    q(el, id).dispatchEvent(new CustomEvent('change', { detail: { value } }));
    await flush();
}

async function mode(el, value) {
    await choose(el, 'mode', value);
}

describe('c-fc-crate-tab', () => {
    beforeEach(() => {
        getObjects.mockResolvedValue([
            { value: 'Account', label: 'Account' },
            { value: 'Case', label: 'Case' }
        ]);
        getListViews.mockImplementation(async ({ objectApiName }) =>
            objectApiName === 'Account' ? [{ value: '00B1', label: 'All Accounts' }] : [{ value: '00B2', label: 'My Cases' }]
        );
        canRunSoql.mockResolvedValue(true);
        searchRecords.mockResolvedValue({
            truncated: false,
            records: [
                { id: '001A', name: 'Acme' },
                { id: '001B', name: 'Acme West' }
            ]
        });
        runQuery.mockResolvedValue(['001A', '001B', '001C']);
        getDocumentFolders.mockResolvedValue([{ value: '005ME', label: 'My Personal Documents' }]);
        getLibraries.mockResolvedValue([{ value: '058A', label: 'Handbooks' }]);
        getDocuments.mockResolvedValue([{ id: '015A', kind: 'Document' }]);
        getLibraryFiles.mockResolvedValue([{ id: '068A', kind: 'File' }]);
        getStaticResources.mockResolvedValue([{ id: '081A', kind: 'StaticResource' }]);
        getEventLogFiles.mockResolvedValue([{ id: '0ATA', kind: 'EventLog' }]);
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    describe('list views', () => {
        it('offers the objects from the server', async () => {
            const el = await mount();
            expect(q(el, 'object').options).toHaveLength(2);
            expect(q(el, 'listview').disabled).toBe(true);
            expect(builder(el)).toBeNull();
        });

        it('adds a list view to the selection when it is chosen', async () => {
            const el = await mount();
            await choose(el, 'object', 'Account');
            expect(getListViews).toHaveBeenCalledWith({ objectApiName: 'Account' });
            await choose(el, 'listview', '00B1');
            expect(builder(el).listViews).toEqual([{ objectApiName: 'Account', listViewId: '00B1', label: 'Account: All Accounts' }]);
            expect(builder(el).request).toMatchObject({ mode: 'listviews', listViews: [{ objectApiName: 'Account', listViewId: '00B1' }] });
        });

        it('collects list views from several objects', async () => {
            const el = await mount();
            await choose(el, 'object', 'Account');
            await choose(el, 'listview', '00B1');
            await choose(el, 'object', 'Case');
            await choose(el, 'listview', '00B2');
            await choose(el, 'listview', '00B2');
            expect(builder(el).listViews.map((v) => v.listViewId)).toEqual(['00B1', '00B2']);
            expect(builder(el).objectApiName).toBeUndefined();
        });

        it('names the object when only one object is selected', async () => {
            const el = await mount();
            await choose(el, 'object', 'Account');
            await choose(el, 'listview', '00B1');
            expect(builder(el).objectApiName).toBe('Account');
        });

        it('removes a list view from the selection', async () => {
            const el = await mount();
            await choose(el, 'object', 'Account');
            await choose(el, 'listview', '00B1');
            el.shadowRoot.querySelector('[data-selection="00B1"]').dispatchEvent(new CustomEvent('remove'));
            await flush();
            expect(builder(el)).toBeNull();
        });

        it('says so when the object has no list views', async () => {
            getListViews.mockResolvedValue([]);
            const el = await mount();
            expect(q(el, 'no-listviews')).toBeNull();
            await choose(el, 'object', 'Account');
            expect(q(el, 'no-listviews')).not.toBeNull();
        });

        it('shows an error when the objects cannot be loaded', async () => {
            getObjects.mockRejectedValue({ body: { message: 'nope' } });
            const el = await mount();
            expect(q(el, 'error').textContent).toContain('nope');
        });
    });

    describe('search', () => {
        it('searches the chosen object and downloads from the ticked records', async () => {
            const el = await mount();
            await mode(el, 'search');
            await choose(el, 'search-object', 'Account');
            q(el, 'search-term').value = 'acme';
            q(el, 'search-term').dispatchEvent(new CustomEvent('change', { detail: { value: 'acme' } }));
            q(el, 'search-run').click();
            await flush();
            expect(searchRecords).toHaveBeenCalledWith({ objectApiName: 'Account', term: 'acme' });
            expect(q(el, 'search-results').data).toHaveLength(2);
            expect(builder(el)).toBeNull();

            q(el, 'search-results').dispatchEvent(new CustomEvent('rowselection', { detail: { selectedRows: [{ id: '001B', name: 'Acme West' }] } }));
            await flush();
            expect(builder(el).recordIds).toEqual(['001B']);
            expect(builder(el).objectApiName).toBe('Account');
            expect(builder(el).request).toEqual({ mode: 'search', objectApiName: 'Account', term: 'acme', recordIds: ['001B'] });
        });

        it('says so when there are more matches than it shows', async () => {
            searchRecords.mockResolvedValue({ truncated: true, records: [{ id: '001A', name: 'Acme' }] });
            const el = await mount();
            await mode(el, 'search');
            await choose(el, 'search-object', 'Account');
            q(el, 'search-term').dispatchEvent(new CustomEvent('change', { detail: { value: 'acme' } }));
            expect(q(el, 'search-truncated')).toBeNull();
            q(el, 'search-run').click();
            await flush();
            expect(q(el, 'search-truncated')).not.toBeNull();
        });

        it('says so when nothing is found', async () => {
            searchRecords.mockResolvedValue({ truncated: false, records: [] });
            const el = await mount();
            await mode(el, 'search');
            await choose(el, 'search-object', 'Account');
            q(el, 'search-term').dispatchEvent(new CustomEvent('change', { detail: { value: 'zzz' } }));
            q(el, 'search-run').click();
            await flush();
            expect(q(el, 'search-empty')).not.toBeNull();
        });
    });

    describe('SOQL', () => {
        it('is offered only to users with the permission', async () => {
            canRunSoql.mockResolvedValue(false);
            const el = await mount();
            expect(q(el, 'mode').options.map((o) => o.value)).toEqual(['listviews', 'search', 'orgfiles', 'history']);
            const el2 = await (async () => {
                canRunSoql.mockResolvedValue(true);
                return mount();
            })();
            expect(q(el2, 'mode').options.map((o) => o.value)).toEqual(['listviews', 'search', 'soql', 'orgfiles', 'history']);
        });

        it('runs the query and downloads from the records it returns', async () => {
            const el = await mount();
            await mode(el, 'soql');
            q(el, 'soql-text').dispatchEvent(new CustomEvent('change', { detail: { value: "SELECT Id FROM Account WHERE Industry = 'Banking'" } }));
            q(el, 'soql-run').click();
            await flush();
            expect(runQuery).toHaveBeenCalledWith({ soql: "SELECT Id FROM Account WHERE Industry = 'Banking'" });
            expect(builder(el).recordIds).toEqual(['001A', '001B', '001C']);
            expect(builder(el).objectApiName).toBe('Account');
            expect(builder(el).request).toEqual({ mode: 'soql', objectApiName: 'Account', soql: "SELECT Id FROM Account WHERE Industry = 'Banking'" });
        });

        it('shows the server message when the query is rejected', async () => {
            runQuery.mockRejectedValue({ body: { message: 'The query must start with SELECT Id FROM' } });
            const el = await mount();
            await mode(el, 'soql');
            q(el, 'soql-text').dispatchEvent(new CustomEvent('change', { detail: { value: 'DELETE' } }));
            q(el, 'soql-run').click();
            await flush();
            expect(q(el, 'error').textContent).toContain('SELECT Id FROM');
            expect(builder(el)).toBeNull();
        });
    });

    describe('org files', () => {
        it('loads documents from a folder', async () => {
            const el = await mount();
            await mode(el, 'orgfiles');
            await choose(el, 'org-source', 'documents');
            expect(q(el, 'org-folder').options[0].value).toBe('all');
            await choose(el, 'org-folder', '005ME');
            q(el, 'org-load').click();
            await flush();
            expect(getDocuments).toHaveBeenCalledWith({ folderId: '005ME' });
            expect(builder(el).presetRows).toEqual([{ id: '015A', kind: 'Document' }]);
            expect(builder(el).presetLabel).toBe('Documents');
            expect(builder(el).request).toEqual({ mode: 'orgfiles', source: 'documents', folderId: '005ME' });
        });

        it('loads every document when no folder is chosen', async () => {
            const el = await mount();
            await mode(el, 'orgfiles');
            await choose(el, 'org-source', 'documents');
            q(el, 'org-load').click();
            await flush();
            expect(getDocuments).toHaveBeenCalledWith({ folderId: null });
        });

        it('loads the files of a library', async () => {
            const el = await mount();
            await mode(el, 'orgfiles');
            await choose(el, 'org-source', 'library');
            await choose(el, 'org-library', '058A');
            q(el, 'org-load').click();
            await flush();
            expect(getLibraryFiles).toHaveBeenCalledWith({ libraryId: '058A' });
            expect(builder(el).presetLabel).toBe('Library');
        });

        it('loads static resources', async () => {
            const el = await mount();
            await mode(el, 'orgfiles');
            await choose(el, 'org-source', 'staticresources');
            q(el, 'org-load').click();
            await flush();
            expect(getStaticResources).toHaveBeenCalled();
            expect(builder(el).presetRows).toEqual([{ id: '081A', kind: 'StaticResource' }]);
            expect(builder(el).presetLabel).toBe('StaticResources');
        });

        it('loads event logs for a type and date range', async () => {
            const el = await mount();
            await mode(el, 'orgfiles');
            await choose(el, 'org-source', 'eventlogs');
            await choose(el, 'org-event-type', 'Login');
            await choose(el, 'org-from', '2026-11-01');
            await choose(el, 'org-to', '2026-11-13');
            q(el, 'org-load').click();
            await flush();
            expect(getEventLogFiles).toHaveBeenCalledWith({ eventType: 'Login', fromDate: '2026-11-01', toDate: '2026-11-13' });
            expect(builder(el).request).toEqual({ mode: 'orgfiles', source: 'eventlogs', eventType: 'Login', fromDate: '2026-11-01', toDate: '2026-11-13' });
        });

        it('shows the server message when a source cannot be read', async () => {
            getEventLogFiles.mockRejectedValue({ body: { message: 'You need the View Event Log Files permission' } });
            const el = await mount();
            await mode(el, 'orgfiles');
            await choose(el, 'org-source', 'eventlogs');
            q(el, 'org-load').click();
            await flush();
            expect(q(el, 'error').textContent).toContain('View Event Log Files');
        });
    });

    describe('history and re-run', () => {
        async function rerun(el, request) {
            await mode(el, 'history');
            el.shadowRoot.querySelector('c-fc-job-history').dispatchEvent(new CustomEvent('rerun', { detail: { request } }));
            await flush();
        }

        it('shows the job history', async () => {
            const el = await mount();
            await mode(el, 'history');
            expect(el.shadowRoot.querySelector('c-fc-job-history')).not.toBeNull();
        });

        it('restores a list view run with its options', async () => {
            const el = await mount();
            await rerun(el, { mode: 'listviews', listViews: [{ objectApiName: 'Account', listViewId: '00B1', label: 'Account: All Accounts' }], options: { layout: 'Flat' } });
            expect(q(el, 'mode').value).toBe('listviews');
            expect(builder(el).listViews).toHaveLength(1);
            expect(builder(el).initialOptions).toEqual({ layout: 'Flat' });
        });

        it('restores a run that started from record ids', async () => {
            const el = await mount();
            await rerun(el, { mode: 'records', objectApiName: 'Account', recordIds: ['001A', '001B'], options: {} });
            expect(builder(el).recordIds).toEqual(['001A', '001B']);
            expect(builder(el).objectApiName).toBe('Account');
        });

        it('fills in a saved query but waits for the user to run it', async () => {
            const el = await mount();
            await rerun(el, { mode: 'soql', objectApiName: 'Account', soql: 'SELECT Id FROM Account', options: {} });
            expect(q(el, 'mode').value).toBe('soql');
            expect(q(el, 'soql-text').value).toBe('SELECT Id FROM Account');
            expect(runQuery).not.toHaveBeenCalled();
            expect(builder(el)).toBeNull();
        });

        it('survives a saved request with a broken shape', async () => {
            const el = await mount();
            await rerun(el, { mode: 'listviews', listViews: [null, { objectApiName: 'Account' }, 'x', { objectApiName: 'Case', listViewId: '00B2', label: 7 }], options: 'nope' });
            expect(builder(el).listViews).toEqual([{ objectApiName: 'Case', listViewId: '00B2', label: 'Case' }]);
            expect(builder(el).initialOptions).toBeNull();
            await rerun(el, { mode: 'records', recordIds: 'not a list' });
            expect(builder(el)).toBeNull();
        });

        it('explains when a saved run had too many records to repeat', async () => {
            const el = await mount();
            await rerun(el, { mode: 'records', objectApiName: 'Account', recordIds: ['001A'], recordIdsTruncated: true });
            expect(q(el, 'error').textContent).toBe('c.Fc_Rerun_Truncated');
            expect(builder(el)).toBeNull();
        });

        it('loads a saved org file source again', async () => {
            const el = await mount();
            await rerun(el, { mode: 'orgfiles', source: 'library', libraryId: '058A', options: {} });
            expect(getLibraryFiles).toHaveBeenCalledWith({ libraryId: '058A' });
            expect(builder(el).presetLabel).toBe('Library');
        });
    });
});
