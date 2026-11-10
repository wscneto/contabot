// Inclui supabase/functions/_shared no bundle: a seleção de quadros
// (frame-selection.ts) é o mesmo código no celular e na Edge Function.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../supabase/functions/_shared')];

module.exports = config;
