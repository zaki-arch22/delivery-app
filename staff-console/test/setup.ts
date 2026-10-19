import '@testing-library/jest-dom/vitest';
// jsdom (the test browser) has no URL.createObjectURL; real browsers do. Give each blob a unique blob: address.
let blobs = 0;
if (!URL.createObjectURL) Object.assign(URL, { createObjectURL: () => `blob:test/${++blobs}`, revokeObjectURL: () => {} });
