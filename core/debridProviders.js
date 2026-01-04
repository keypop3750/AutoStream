/**
 * Unified Debrid Provider Configuration
 * Following Torrentio's multi-debrid approach
 */

const DEBRID_PROVIDERS = {
 realdebrid: {
 key: 'realdebrid',
 name: 'RealDebrid',
 shortName: 'RD',
 apiBaseUrl: 'https://api.real-debrid.com/rest/1.0',
 authHeader: 'Bearer',
 enabled: true
 },
 alldebrid: {
 key: 'alldebrid', 
 name: 'AllDebrid',
 shortName: 'AD',
 apiBaseUrl: 'https://api.alldebrid.com/v4', // Confirmed v4 works
 authHeader: 'Bearer', // AllDebrid DOES use Authorization Bearer headers
 headers: {
 'User-Agent': 'AutoStream/3.0' // Required for hosting providers
 },
 enabled: true
 },
 premiumize: {
 key: 'premiumize',
 name: 'Premiumize',
 shortName: 'PM', 
 apiBaseUrl: 'https://premiumize.me/api',
 authHeader: 'Bearer',
 enabled: true
 },
 easydebrid: {
 key: 'easydebrid',
 name: 'EasyDebrid', 
 shortName: 'ED',
 apiBaseUrl: 'https://easydebrid.com/api/v1',
 authHeader: 'Bearer',
 enabled: true
 },
 debridlink: {
 key: 'debridlink',
 name: 'DebridLink',
 shortName: 'DL', 
 apiBaseUrl: 'https://debrid-link.fr/api',
 authHeader: 'Bearer',
 enabled: true
 },
 torbox: {
 key: 'torbox',
 name: 'TorBox',
 shortName: 'TB',
 apiBaseUrl: 'https://api.torbox.app/v1/api',
 authHeader: 'Bearer', 
 enabled: true
 },
 offcloud: {
 key: 'offcloud',
 name: 'Offcloud',
 shortName: 'OC',
 apiBaseUrl: 'https://offcloud.com/api',
 authHeader: 'Bearer',
 enabled: true
 },
 putio: {
 key: 'putio',
 name: 'Put.io',
 shortName: 'PI',
 apiBaseUrl: 'https://api.put.io/v2',
 authHeader: 'Bearer',
 enabled: true
 }
};

/**
 * Get all enabled debrid providers
 */
function getEnabledProviders() {
 return Object.values(DEBRID_PROVIDERS).filter(provider => provider.enabled);
}

/**
 * Get provider configuration by key
 */
function getProvider(key) {
 return DEBRID_PROVIDERS[key];
}

/**
 * Get all provider keys
 */
function getProviderKeys() {
 return Object.keys(DEBRID_PROVIDERS);
}

/**
 * Check if a provider key is valid
 */
function isValidProvider(key) {
 return DEBRID_PROVIDERS.hasOwnProperty(key);
}

/**
 * Get provider display name for stream naming
 */
function getProviderDisplayName(key) {
 const provider = getProvider(key);
 return provider ? provider.shortName : 'Unknown';
}

/**
 * Detect debrid provider from configuration
 * Returns the first configured provider found
 */
function detectConfiguredProvider(config) {
 for (const providerKey of getProviderKeys()) {
 if (config[providerKey]) {
 return providerKey;
 }
 }
 return null;
}

/**
 * Get all configured providers from config
 */
function getConfiguredProviders(config) {
 const configured = [];
 for (const providerKey of getProviderKeys()) {
 if (config[providerKey]) {
 configured.push({
 key: providerKey,
 provider: getProvider(providerKey),
 token: config[providerKey]
 });
 }
 }
 return configured;
}

/**
 * Validate provider API key format
 */
function isValidApiKey(key, providerKey) {
 if (!key || typeof key !== 'string') return false;
 
 // Basic validation - minimum length
 if (key.length < 10) return false;
 
 // Provider-specific validation can be added here
 switch (providerKey) {
 case 'realdebrid':
 return key.length >= 15; // RD tokens are usually longer
 case 'alldebrid':
 return key.length >= 15; // AD tokens are usually longer
 case 'easydebrid':
 return key.length >= 10; // ED tokens vary
 default:
 return key.length >= 10; // Minimum for others
 }
}

/**
 * Unified provider validation - validates API key with provider's API
 * @param {string} providerKey - The provider key (alldebrid, realdebrid, etc)
 * @param {string} token - The API token
 * @param {Object} validators - Object containing validation functions (validateAllDebridKey, validateDebridKey)
 * @returns {Promise<boolean>} - True if valid
 */
async function validateProviderKey(providerKey, token, validators) {
 const { validateAllDebridKey, validateDebridKey } = validators;
 
 try {
 switch (providerKey) {
 case 'alldebrid':
 return await validateAllDebridKey(token);
 case 'realdebrid':
 return await validateDebridKey('rd', token);
 case 'premiumize':
 return await validateDebridKey('pm', token);
 case 'torbox':
 return await validateDebridKey('tb', token);
 case 'offcloud':
 return await validateDebridKey('oc', token);
 case 'easydebrid':
 return await validateDebridKey('ed', token);
 case 'debridlink':
 return await validateDebridKey('dl', token);
 case 'putio':
 return await validateDebridKey('pu', token);
 default:
 console.log(`[WARN] No validation method for provider: ${providerKey}`);
 return isValidApiKey(token, providerKey); // Fallback to format validation
 }
 } catch (e) {
 console.error(`[FAIL] ${providerKey} validation error:`, e.message);
 return false;
 }
}

/**
 * Validate all configured providers in parallel
 * @param {Array} configuredProviders - Array from getConfiguredProviders()
 * @param {Object} validators - Object containing validation functions
 * @returns {Promise<Array>} - Array of validated working providers
 */
async function validateProvidersParallel(configuredProviders, validators) {
 const validationPromises = configuredProviders.map(async ({ key, provider, token }) => {
 console.log(`[SEARCH] Validating ${provider.name} API key...`);
 const isValid = await validateProviderKey(key, token, validators);
 
 if (isValid) {
 console.log(`[OK] ${provider.name} API key validated successfully`);
 return { key, provider, token, valid: true };
 } else {
 console.log(`[FAIL] ${provider.name} API key validation failed`);
 return { key, provider, token, valid: false };
 }
 });
 
 const results = await Promise.allSettled(validationPromises);
 
 // Filter to only working providers
 return results
 .filter(r => r.status === 'fulfilled' && r.value.valid)
 .map(r => ({ key: r.value.key, provider: r.value.provider, token: r.value.token }));
}

module.exports = {
 DEBRID_PROVIDERS,
 getEnabledProviders,
 getAllProviders: () => DEBRID_PROVIDERS,
 getProvider,
 getProviderKeys,
 isValidProvider,
 getProviderDisplayName,
 detectConfiguredProvider,
 getConfiguredProviders,
 isValidApiKey,
 validateProviderKey,
 validateProvidersParallel,
 validateProviderConfig: (provider, key) => isValidProvider(provider) && isValidApiKey(provider, key)
};
