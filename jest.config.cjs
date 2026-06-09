/** @type {import('jest').Config} */
// Plain CommonJS config so `npm test` runs without a ts-node dependency.
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        target: 'ES2022',
        module: 'commonjs',
        lib: ['ES2022'],
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
    }],
  },
  moduleNameMapper: {
    '^electron$': '<rootDir>/src/__mocks__/electron.ts',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/__tests__/**',
    '!src/**/__mocks__/**',
  ],
};
