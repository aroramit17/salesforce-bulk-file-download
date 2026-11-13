const { jestConfig } = require('@salesforce/sfdx-lwc-jest/config');

module.exports = {
    ...jestConfig,
    roots: ['<rootDir>/force-app', '<rootDir>/engine'],
    modulePathIgnorePatterns: ['<rootDir>/.localdevserver']
};
