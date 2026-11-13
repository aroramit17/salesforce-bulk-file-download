import { createElement } from 'lwc';
import FcCrateTab from 'c/fcCrateTab';
import getObjects from '@salesforce/apex/FcRecordService.getObjects';
import getListViews from '@salesforce/apex/FcRecordService.getListViews';

jest.mock('c/fcCrateBuilder');
jest.mock('@salesforce/apex/FcRecordService.getObjects', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/FcRecordService.getListViews', () => ({ default: jest.fn() }), { virtual: true });

const flush = async () => {
    for (let i = 0; i < 6; i++) {
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

function choose(el, id, value) {
    el.shadowRoot.querySelector('[data-id="' + id + '"]').dispatchEvent(new CustomEvent('change', { detail: { value } }));
}

describe('c-fc-crate-tab', () => {
    beforeEach(() => {
        getObjects.mockResolvedValue([
            { value: 'Account', label: 'Account' },
            { value: 'Case', label: 'Case' }
        ]);
        getListViews.mockResolvedValue([{ value: '00B1', label: 'All Accounts' }]);
    });

    afterEach(() => {
        while (document.body.firstChild) {
            document.body.removeChild(document.body.firstChild);
        }
        jest.clearAllMocks();
    });

    it('offers the objects from the server', async () => {
        const el = await mount();
        expect(el.shadowRoot.querySelector('[data-id="object"]').options).toHaveLength(2);
        expect(el.shadowRoot.querySelector('[data-id="listview"]').disabled).toBe(true);
    });

    it('loads list views once an object is chosen', async () => {
        const el = await mount();
        choose(el, 'object', 'Account');
        await flush();
        expect(getListViews).toHaveBeenCalledWith({ objectApiName: 'Account' });
        const views = el.shadowRoot.querySelector('[data-id="listview"]');
        expect(views.disabled).toBe(false);
        expect(views.options).toEqual([{ value: '00B1', label: 'All Accounts' }]);
        expect(el.shadowRoot.querySelector('c-fc-crate-builder')).toBeNull();
    });

    it('shows the builder for the chosen list view', async () => {
        const el = await mount();
        choose(el, 'object', 'Account');
        await flush();
        choose(el, 'listview', '00B1');
        await flush();
        const builder = el.shadowRoot.querySelector('c-fc-crate-builder');
        expect(builder.listViewId).toBe('00B1');
        expect(builder.objectApiName).toBe('Account');
    });

    it('drops the builder when the object changes', async () => {
        const el = await mount();
        choose(el, 'object', 'Account');
        await flush();
        choose(el, 'listview', '00B1');
        await flush();
        choose(el, 'object', 'Case');
        await flush();
        expect(el.shadowRoot.querySelector('c-fc-crate-builder')).toBeNull();
        expect(getListViews).toHaveBeenLastCalledWith({ objectApiName: 'Case' });
    });

    it('says so when the object has no list views', async () => {
        getListViews.mockResolvedValue([]);
        const el = await mount();
        expect(el.shadowRoot.querySelector('[data-id="no-listviews"]')).toBeNull();
        choose(el, 'object', 'Account');
        await flush();
        expect(el.shadowRoot.querySelector('[data-id="no-listviews"]')).not.toBeNull();
    });

    it('shows an error when the objects cannot be loaded', async () => {
        getObjects.mockRejectedValue({ body: { message: 'nope' } });
        const el = await mount();
        expect(el.shadowRoot.querySelector('[data-id="error"]').textContent).toContain('nope');
    });
});
