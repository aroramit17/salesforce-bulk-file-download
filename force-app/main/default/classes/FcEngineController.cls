/**
 * Controller for FcEngine.page. Exposes configuration only; no file data
 * passes through Apex.
 */
public with sharing class FcEngineController {
    public String getApiVersion() {
        return '66.0';
    }

    /** The only origin the engine page accepts messages from and replies to. */
    public String getLightningOrigin() {
        return lightningOriginFor(URL.getOrgDomainUrl().getHost());
    }

    public String getBaseUrl() {
        return URL.getOrgDomainUrl().toExternalForm();
    }

    public static String lightningOriginFor(String host) {
        return 'https://' + host.replace('.my.salesforce.com', '.lightning.force.com');
    }
}
