// MOCK gate (B6 ruling I16): features with no backend show their static seed only on a demo deployment (server env ENABLE_MOCK_MODULES=1). T6.9 adds the registry list.
export const mockEnabled = (): boolean => process.env.ENABLE_MOCK_MODULES === "1"
