/**
 * GlobalSettingsRepository - Manages global application settings
 *
 * Stores application-wide settings that are not project-specific.
 */

import { eq } from "drizzle-orm";
import { globalSettings, type GlobalSettingsRow } from "@dev-workflow/database/schema.js";
import type { DrizzleDb } from "@dev-workflow/database/drizzle-db.js";

/**
 * Interface for global settings repository
 */
export interface GlobalSettingsRepository {
  /**
   * Get a setting value by key
   *
   * @param key - Setting key
   * @returns Setting value or null if not found
   */
  get<T>(key: string): T | null;

  /**
   * Set a setting value
   *
   * @param key - Setting key
   * @param value - Setting value (will be JSON serialized)
   */
  set<T>(key: string, value: T): void;

  /**
   * Delete a setting
   *
   * @param key - Setting key
   */
  delete(key: string): void;
}

/**
 * Drizzle implementation of GlobalSettingsRepository
 */
export class DrizzleGlobalSettingsRepository implements GlobalSettingsRepository {
  constructor(private readonly db: DrizzleDb) {}

  get<T>(key: string): T | null {
    const result = this.db.select().from(globalSettings).where(eq(globalSettings.key, key)).get();

    if (!result) {
      return null;
    }

    return result.value as T;
  }

  set<T>(key: string, value: T): void {
    const now = new Date().toISOString();
    const existing = this.db.select().from(globalSettings).where(eq(globalSettings.key, key)).get();

    if (existing) {
      this.db
        .update(globalSettings)
        .set({
          value: value as GlobalSettingsRow["value"],
          updatedAt: now,
        })
        .where(eq(globalSettings.key, key))
        .run();
    } else {
      this.db
        .insert(globalSettings)
        .values({
          key,
          value: value as GlobalSettingsRow["value"],
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  delete(key: string): void {
    this.db.delete(globalSettings).where(eq(globalSettings.key, key)).run();
  }
}
