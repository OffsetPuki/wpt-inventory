import type { CustomField, TemplateParam, TemplatePart, Category } from "./schema";

// Seed-data shapes shared by the preset catalogs (see cjm-presets.ts).
// The legacy WPT catalog that used to live here was removed; the live DB
// already carries its rows and fresh installs seed CJM presets only.

export interface EquipmentPresetSeed {
  key: string;
  label: string;
  blurb: string;
  icon: string;
  defaultCategory: Category;
  examples: string[];
  customFields: CustomField[];
}

export interface JobTemplateSeed {
  key: string;
  label: string;
  blurb: string;
  icon: string;
  params: TemplateParam[];
  parts: TemplatePart[];
}
