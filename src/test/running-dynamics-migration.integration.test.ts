// @vitest-environment node
import { readFile } from "node:fs/promises";
import postgres from "postgres";
import { describe, expect, it } from "vitest";

const suite = process.env.TEST_DATABASE_URL ? describe : describe.skip;

suite("running dynamics additive PostgreSQL migration", () => {
  it("migrates legacy rows and can rerun without erasing values or changing identity", async () => {
    const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1, prepare: false });
    const schema = `dynamics_${crypto.randomUUID().replaceAll("-", "")}`;
    try {
      await sql`create schema ${sql(schema)}`;
      await sql`set search_path to ${sql(schema)}`;
      await sql`create table run_activities (id integer primary key, distance_meters integer, effort_override text)`;
      await sql`create table activity_samples (id integer primary key, activity_id integer, elapsed_seconds integer,
        heart_rate integer, power integer, unique(activity_id, elapsed_seconds))`;
      await sql`insert into run_activities values (1, 5000, 'easy')`;
      await sql`insert into activity_samples values (7, 1, 30, 140, 300)`;
      const migration = await readFile(new URL("../../scripts/add-running-dynamics.sql", import.meta.url), "utf8");
      await sql.unsafe(migration);
      const [legacy] = await sql`select * from activity_samples`;
      expect(legacy).toMatchObject({ id: 7, activity_id: 1, elapsed_seconds: 30, heart_rate: 140, power: 300,
        vertical_oscillation_cm: null, vertical_ratio_percent: null, ground_contact_time_ms: null,
        ground_contact_balance_left_percent: null, stride_length_cm: null });
      await sql`update activity_samples set vertical_oscillation_cm = 6.44, vertical_ratio_percent = 5.71,
        ground_contact_time_ms = 272.3, ground_contact_balance_left_percent = 50.79, stride_length_cm = 109.14`;
      await sql`update run_activities set stride_length_cm = 109.14`;
      const before = await sql`select * from activity_samples`;
      await sql.unsafe(migration);
      expect(await sql`select * from activity_samples`).toEqual(before);
      expect(await sql`select * from run_activities`).toMatchObject([{ id: 1, distance_meters: 5000, effort_override: "easy", stride_length_cm: 109.14 }]);
      const columns = await sql`select data_type, is_nullable from information_schema.columns
        where table_schema = ${schema} and column_name in ('vertical_oscillation_cm', 'vertical_ratio_percent',
          'ground_contact_time_ms', 'ground_contact_balance_left_percent', 'stride_length_cm')`;
      expect(columns).toHaveLength(10);
      expect(columns.every((column) => column.data_type === "double precision" && column.is_nullable === "YES")).toBe(true);
    } finally {
      await sql`set search_path to public`;
      await sql`drop schema if exists ${sql(schema)} cascade`;
      await sql.end();
    }
  });
});
