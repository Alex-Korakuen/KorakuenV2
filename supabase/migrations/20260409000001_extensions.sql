-- Migration: extensions
-- Enable pgcrypto for gen_random_uuid() compatibility

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
