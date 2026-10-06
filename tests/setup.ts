process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://erp:erp_local_dev@localhost:5432/erp_test";
process.env.APP_ENV = "test";
process.env.SESSION_SECRET ??= "test-secret";
process.env.STORAGE_DIR ??= "./storage-test";
