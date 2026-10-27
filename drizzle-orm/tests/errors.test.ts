import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import { drizzle } from '~/better-sqlite3/index.ts';
import {
	CheckConstraintError,
	DrizzleCheckConstraintError,
	DrizzleConstraintError,
	DrizzleError,
	DrizzleForeignKeyConstraintError,
	DrizzleNotNullConstraintError,
	DrizzleQueryError,
	DrizzleUniqueConstraintError,
	ForeignKeyConstraintError,
	is,
	isCheckConstraintError,
	isConstraintError,
	isDrizzleConstraintError,
	isDrizzleError,
	isDrizzleQueryError,
	isForeignKeyConstraintError,
	isNotNullConstraintError,
	isUniqueConstraintError,
	NotNullConstraintError,
	parseDatabaseError,
	sql,
	TransactionRollbackError,
	UniqueConstraintError,
} from '~/index.ts';
import { check, integer, sqliteTable, text } from '~/sqlite-core/index.ts';

describe('Error Handling and Wrapping (#376)', () => {
	describe('DrizzleError Base Class & TransactionRollbackError', () => {
		test('DrizzleError sets name and preserves cause', () => {
			const cause = new Error('root cause');
			const err = new DrizzleError({ message: 'Custom message', cause });

			expect(err).toBeInstanceOf(Error);
			expect(err).toBeInstanceOf(DrizzleError);
			expect(is(err, DrizzleError)).toBe(true);
			expect(isDrizzleError(err)).toBe(true);
			expect(err.name).toBe('DrizzleError');
			expect(err.message).toBe('Custom message');
			expect(err.cause).toBe(cause);
		});

		test('TransactionRollbackError extends DrizzleError', () => {
			const err = new TransactionRollbackError();

			expect(err).toBeInstanceOf(Error);
			expect(err).toBeInstanceOf(DrizzleError);
			expect(err).toBeInstanceOf(TransactionRollbackError);
			expect(is(err, TransactionRollbackError)).toBe(true);
			expect(is(err, DrizzleError)).toBe(true);
			expect(isDrizzleError(err)).toBe(true);
			expect(err.message).toBe('Rollback');
			expect(err.name).toBe('TransactionRollbackError');
		});
	});

	describe('DrizzleQueryError Hierarchy & Inheritance', () => {
		test('generic query failure instantiates DrizzleQueryError', () => {
			const syntaxErr = new Error('syntax error at or near "SELEKT"');
			const err = new DrizzleQueryError('SELEKT 1', [], syntaxErr);

			expect(err).toBeInstanceOf(Error);
			expect(err).toBeInstanceOf(DrizzleError);
			expect(err).toBeInstanceOf(DrizzleQueryError);
			expect(err).not.toBeInstanceOf(DrizzleConstraintError);
			expect(is(err, DrizzleQueryError)).toBe(true);
			expect(is(err, DrizzleError)).toBe(true);
			expect(is(err, DrizzleConstraintError)).toBe(false);
			expect(isDrizzleQueryError(err)).toBe(true);
			expect(isDrizzleError(err)).toBe(true);
			expect(isConstraintError(err)).toBe(false);
			expect(isDrizzleConstraintError(err)).toBe(false);

			expect(err.name).toBe('DrizzleQueryError');
			expect(err.query).toBe('SELEKT 1');
			expect(err.params).toEqual([]);
			expect(err.cause).toBe(syntaxErr);
			expect(err.kind).toBe('unknown');
			expect(err.isConstraint()).toBe(false);
			expect(err.isUniqueConstraint()).toBe(false);
			expect(err.isForeignKeyConstraint()).toBe(false);
			expect(err.isNotNullConstraint()).toBe(false);
			expect(err.isCheckConstraint()).toBe(false);
			expect(err.message).toContain('SELEKT 1');
		});

		test('aliases match the subclass implementations', () => {
			expect(DrizzleUniqueConstraintError).toBe(UniqueConstraintError);
			expect(DrizzleForeignKeyConstraintError).toBe(ForeignKeyConstraintError);
			expect(DrizzleNotNullConstraintError).toBe(NotNullConstraintError);
			expect(DrizzleCheckConstraintError).toBe(CheckConstraintError);
			expect(isDrizzleConstraintError).toBe(isConstraintError);
		});

		test('direct subclass instantiation works as expected', () => {
			const uq = new UniqueConstraintError('INSERT INTO t ...', [1]);
			expect(uq).toBeInstanceOf(UniqueConstraintError);
			expect(uq).toBeInstanceOf(DrizzleConstraintError);
			expect(uq).toBeInstanceOf(DrizzleQueryError);
			expect(uq).toBeInstanceOf(DrizzleError);
			expect(uq.kind).toBe('unique_constraint');
			expect(uq.name).toBe('UniqueConstraintError');
			expect(is(uq, UniqueConstraintError)).toBe(true);
			expect(is(uq, DrizzleConstraintError)).toBe(true);
			expect(is(uq, DrizzleQueryError)).toBe(true);
			expect(is(uq, DrizzleError)).toBe(true);
			expect(isUniqueConstraintError(uq)).toBe(true);
			expect(isConstraintError(uq)).toBe(true);
			expect(uq.isUniqueConstraint()).toBe(true);
			expect(uq.isConstraint()).toBe(true);
		});
	});

	describe('PostgreSQL Driver Errors (pg, postgres.js, neon, pglite)', () => {
		test('wraps 23505 unique violation into UniqueConstraintError with full metadata', () => {
			const pgErr = {
				name: 'error',
				code: '23505',
				table: 'users',
				column: 'email',
				constraint: 'users_email_unique',
				detail: 'Key (email)=(test@example.com) already exists.',
				schema: 'public',
			};

			const err = new DrizzleQueryError('INSERT INTO users (email) VALUES ($1)', ['test@example.com'], pgErr);

			expect(err).toBeInstanceOf(UniqueConstraintError);
			expect(err).toBeInstanceOf(DrizzleConstraintError);
			expect(err).toBeInstanceOf(DrizzleQueryError);
			expect(err).toBeInstanceOf(DrizzleError);
			expect(is(err, UniqueConstraintError)).toBe(true);
			expect(is(err, DrizzleConstraintError)).toBe(true);
			expect(is(err, DrizzleQueryError)).toBe(true);
			expect(isUniqueConstraintError(err)).toBe(true);
			expect(isConstraintError(err)).toBe(true);
			expect(err.isUniqueConstraint()).toBe(true);
			expect(err.isConstraint()).toBe(true);
			expect(err.isForeignKeyConstraint()).toBe(false);

			expect(err.kind).toBe('unique_constraint');
			expect(err.code).toBe('23505');
			expect(err.table).toBe('users');
			expect(err.column).toBe('email');
			expect(err.constraint).toBe('users_email_unique');
			expect(err.detail).toBe('Key (email)=(test@example.com) already exists.');
			expect(err.schema).toBe('public');
			expect(err.query).toBe('INSERT INTO users (email) VALUES ($1)');
			expect(err.params).toEqual(['test@example.com']);
			expect(err.cause).toBe(pgErr);
		});

		test('extracts column from detail when column is omitted in pg unique error', () => {
			const pgErr = {
				code: '23505',
				table: 'users',
				detail: 'Key (username)=(john_doe) already exists.',
			};

			const err = new DrizzleQueryError('INSERT INTO users ...', ['john_doe'], pgErr);

			expect(err).toBeInstanceOf(UniqueConstraintError);
			expect(err.column).toBe('username');
			expect(err.table).toBe('users');
		});

		test('supports postgres.js property names (table_name, column_name, constraint_name, schema_name)', () => {
			const postgresJsErr = {
				code: '23505',
				table_name: 'accounts',
				column_name: 'iban',
				constraint_name: 'accounts_iban_unique',
				schema_name: 'finance',
				detail: 'Key (iban)=(GB00123) already exists.',
			};

			const err = new DrizzleQueryError('INSERT INTO accounts ...', ['GB00123'], postgresJsErr);

			expect(err).toBeInstanceOf(UniqueConstraintError);
			expect(err.table).toBe('accounts');
			expect(err.column).toBe('iban');
			expect(err.constraint).toBe('accounts_iban_unique');
			expect(err.schema).toBe('finance');
		});

		test('wraps 23503 foreign key violation into ForeignKeyConstraintError', () => {
			const pgErr = {
				code: '23503',
				table: 'orders',
				constraint: 'orders_user_id_fk',
				detail: 'Key (user_id)=(999) is not present in table "users".',
				schema: 'public',
			};

			const err = new DrizzleQueryError('INSERT INTO orders (user_id) VALUES ($1)', [999], pgErr);

			expect(err).toBeInstanceOf(ForeignKeyConstraintError);
			expect(err).toBeInstanceOf(DrizzleConstraintError);
			expect(is(err, ForeignKeyConstraintError)).toBe(true);
			expect(isForeignKeyConstraintError(err)).toBe(true);
			expect(err.isForeignKeyConstraint()).toBe(true);
			expect(err.isUniqueConstraint()).toBe(false);
			expect(err.kind).toBe('foreign_key_constraint');
			expect(err.code).toBe('23503');
			expect(err.table).toBe('orders');
			expect(err.column).toBe('user_id');
			expect(err.constraint).toBe('orders_user_id_fk');
		});

		test('wraps 23502 not null violation into NotNullConstraintError', () => {
			const pgErr = {
				code: '23502',
				table: 'users',
				column: 'email',
				schema: 'public',
			};

			const err = new DrizzleQueryError('INSERT INTO users (email) VALUES ($1)', [null], pgErr);

			expect(err).toBeInstanceOf(NotNullConstraintError);
			expect(err).toBeInstanceOf(DrizzleConstraintError);
			expect(is(err, NotNullConstraintError)).toBe(true);
			expect(isNotNullConstraintError(err)).toBe(true);
			expect(err.isNotNullConstraint()).toBe(true);
			expect(err.isUniqueConstraint()).toBe(false);
			expect(err.kind).toBe('not_null_constraint');
			expect(err.code).toBe('23502');
			expect(err.table).toBe('users');
			expect(err.column).toBe('email');
		});

		test('wraps 23514 check violation into CheckConstraintError', () => {
			const pgErr = {
				code: '23514',
				table: 'products',
				constraint: 'price_positive',
				schema: 'public',
			};

			const err = new DrizzleQueryError('INSERT INTO products (price) VALUES ($1)', [-10], pgErr);

			expect(err).toBeInstanceOf(CheckConstraintError);
			expect(err).toBeInstanceOf(DrizzleConstraintError);
			expect(is(err, CheckConstraintError)).toBe(true);
			expect(isCheckConstraintError(err)).toBe(true);
			expect(err.isCheckConstraint()).toBe(true);
			expect(err.isUniqueConstraint()).toBe(false);
			expect(err.kind).toBe('check_constraint');
			expect(err.code).toBe('23514');
			expect(err.table).toBe('products');
			expect(err.constraint).toBe('price_positive');
		});
	});

	describe('MySQL & SingleStore Driver Errors (mysql2, planetscale)', () => {
		test('wraps ER_DUP_ENTRY / 1062 into UniqueConstraintError with parsed fields', () => {
			const mysqlErr = {
				code: 'ER_DUP_ENTRY',
				errno: 1062,
				sqlState: '23000',
				message: "Duplicate entry 'test@example.com' for key 'users.email_unique'",
			};

			const err = new DrizzleQueryError('INSERT INTO users ...', ['test@example.com'], mysqlErr);

			expect(err).toBeInstanceOf(UniqueConstraintError);
			expect(is(err, UniqueConstraintError)).toBe(true);
			expect(isUniqueConstraintError(err)).toBe(true);
			expect(err.isUniqueConstraint()).toBe(true);
			expect(err.kind).toBe('unique_constraint');
			expect(err.code).toBe('ER_DUP_ENTRY');
			expect(err.table).toBe('users');
			expect(err.constraint).toBe('email_unique');
			expect(err.detail).toBe('test@example.com');
		});

		test('wraps ER_NO_REFERENCED_ROW_2 / 1452 into ForeignKeyConstraintError with parsed fields', () => {
			const mysqlErr = {
				code: 'ER_NO_REFERENCED_ROW_2',
				errno: 1452,
				message:
					'Cannot add or update a child row: a foreign key constraint fails (`shop`.`orders`, CONSTRAINT `orders_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`))',
			};

			const err = new DrizzleQueryError('INSERT INTO orders ...', [123], mysqlErr);

			expect(err).toBeInstanceOf(ForeignKeyConstraintError);
			expect(is(err, ForeignKeyConstraintError)).toBe(true);
			expect(isForeignKeyConstraintError(err)).toBe(true);
			expect(err.isForeignKeyConstraint()).toBe(true);
			expect(err.kind).toBe('foreign_key_constraint');
			expect(err.table).toBe('orders');
			expect(err.constraint).toBe('orders_user_id_fk');
			expect(err.column).toBe('user_id');
		});

		test('wraps ER_BAD_NULL_ERROR / 1048 into NotNullConstraintError with parsed column', () => {
			const mysqlErr = {
				code: 'ER_BAD_NULL_ERROR',
				errno: 1048,
				message: "Column 'username' cannot be null",
			};

			const err = new DrizzleQueryError('INSERT INTO users ...', [null], mysqlErr);

			expect(err).toBeInstanceOf(NotNullConstraintError);
			expect(is(err, NotNullConstraintError)).toBe(true);
			expect(isNotNullConstraintError(err)).toBe(true);
			expect(err.isNotNullConstraint()).toBe(true);
			expect(err.kind).toBe('not_null_constraint');
			expect(err.column).toBe('username');
		});

		test('wraps ER_CHECK_CONSTRAINT_VIOLATED / 3819 into CheckConstraintError with parsed constraint', () => {
			const mysqlErr = {
				code: 'ER_CHECK_CONSTRAINT_VIOLATED',
				errno: 3819,
				message: "Check constraint 'chk_min_age' is violated.",
			};

			const err = new DrizzleQueryError('INSERT INTO users ...', [15], mysqlErr);

			expect(err).toBeInstanceOf(CheckConstraintError);
			expect(is(err, CheckConstraintError)).toBe(true);
			expect(isCheckConstraintError(err)).toBe(true);
			expect(err.isCheckConstraint()).toBe(true);
			expect(err.kind).toBe('check_constraint');
			expect(err.constraint).toBe('chk_min_age');
		});
	});

	describe('SQLite Driver Errors (better-sqlite3, libsql, bun:sqlite, d1, sql-js)', () => {
		test('wraps SQLITE_CONSTRAINT_UNIQUE into UniqueConstraintError with parsed table and column', () => {
			const sqliteErr = {
				code: 'SQLITE_CONSTRAINT_UNIQUE',
				message: 'UNIQUE constraint failed: users.email',
			};

			const err = new DrizzleQueryError('INSERT INTO users (email) VALUES (?)', ['test@example.com'], sqliteErr);

			expect(err).toBeInstanceOf(UniqueConstraintError);
			expect(is(err, UniqueConstraintError)).toBe(true);
			expect(isUniqueConstraintError(err)).toBe(true);
			expect(err.isUniqueConstraint()).toBe(true);
			expect(err.kind).toBe('unique_constraint');
			expect(err.table).toBe('users');
			expect(err.column).toBe('email');
			expect(err.code).toBe('SQLITE_CONSTRAINT_UNIQUE');
		});

		test('wraps SQLite PRIMARY KEY must be unique into UniqueConstraintError', () => {
			const sqliteErr = {
				code: 'SQLITE_CONSTRAINT_PRIMARYKEY',
				message: 'PRIMARY KEY must be unique',
			};

			const err = new DrizzleQueryError('INSERT INTO users (id) VALUES (?)', [1], sqliteErr);

			expect(err).toBeInstanceOf(UniqueConstraintError);
			expect(err.kind).toBe('unique_constraint');
		});

		test('wraps SQLITE_CONSTRAINT_FOREIGNKEY into ForeignKeyConstraintError', () => {
			const sqliteErr = {
				code: 'SQLITE_CONSTRAINT_FOREIGNKEY',
				message: 'FOREIGN KEY constraint failed',
			};

			const err = new DrizzleQueryError('INSERT INTO orders (user_id) VALUES (?)', [999], sqliteErr);

			expect(err).toBeInstanceOf(ForeignKeyConstraintError);
			expect(is(err, ForeignKeyConstraintError)).toBe(true);
			expect(isForeignKeyConstraintError(err)).toBe(true);
			expect(err.isForeignKeyConstraint()).toBe(true);
			expect(err.kind).toBe('foreign_key_constraint');
		});

		test('wraps SQLITE_CONSTRAINT_NOTNULL into NotNullConstraintError with table and column', () => {
			const sqliteErr = {
				code: 'SQLITE_CONSTRAINT_NOTNULL',
				message: 'NOT NULL constraint failed: users.name',
			};

			const err = new DrizzleQueryError('INSERT INTO users (name) VALUES (?)', [null], sqliteErr);

			expect(err).toBeInstanceOf(NotNullConstraintError);
			expect(is(err, NotNullConstraintError)).toBe(true);
			expect(isNotNullConstraintError(err)).toBe(true);
			expect(err.isNotNullConstraint()).toBe(true);
			expect(err.kind).toBe('not_null_constraint');
			expect(err.table).toBe('users');
			expect(err.column).toBe('name');
		});

		test('wraps SQLITE_CONSTRAINT_CHECK into CheckConstraintError with constraint expression', () => {
			const sqliteErr = {
				code: 'SQLITE_CONSTRAINT_CHECK',
				message: 'CHECK constraint failed: age >= 0',
			};

			const err = new DrizzleQueryError('INSERT INTO users (age) VALUES (?)', [-1], sqliteErr);

			expect(err).toBeInstanceOf(CheckConstraintError);
			expect(is(err, CheckConstraintError)).toBe(true);
			expect(isCheckConstraintError(err)).toBe(true);
			expect(err.isCheckConstraint()).toBe(true);
			expect(err.kind).toBe('check_constraint');
			expect(err.constraint).toBe('age >= 0');
		});
	});

	describe('Generic Message Fallbacks and Edge Cases', () => {
		test('identifies unique constraint violation from generic error message', () => {
			const rawErr = new Error('Database error: Duplicate key violates unique constraint');
			const err = new DrizzleQueryError('INSERT INTO ...', [], rawErr);

			expect(err).toBeInstanceOf(UniqueConstraintError);
			expect(err.kind).toBe('unique_constraint');
		});

		test('identifies foreign key constraint violation from generic error message', () => {
			const rawErr = new Error('Violates foreign key constraint');
			const err = new DrizzleQueryError('INSERT INTO ...', [], rawErr);

			expect(err).toBeInstanceOf(ForeignKeyConstraintError);
			expect(err.kind).toBe('foreign_key_constraint');
		});

		test('identifies not null constraint violation from generic error message', () => {
			const rawErr = new Error('Field cannot be null in database');
			const err = new DrizzleQueryError('INSERT INTO ...', [], rawErr);

			expect(err).toBeInstanceOf(NotNullConstraintError);
			expect(err.kind).toBe('not_null_constraint');
		});

		test('identifies check constraint violation from generic error message', () => {
			const rawErr = new Error('Row violates check constraint');
			const err = new DrizzleQueryError('INSERT INTO ...', [], rawErr);

			expect(err).toBeInstanceOf(CheckConstraintError);
			expect(err.kind).toBe('check_constraint');
		});

		test('handles undefined or null cause gracefully', () => {
			const errUndefined = new DrizzleQueryError('SELECT 1', []);
			expect(errUndefined.cause).toBeUndefined();
			expect(errUndefined.kind).toBe('unknown');
			expect(errUndefined).toBeInstanceOf(DrizzleQueryError);

			const parsedNull = parseDatabaseError(null);
			expect(parsedNull.kind).toBe('unknown');

			const parsedPrimitive = parseDatabaseError('error string');
			expect(parsedPrimitive.kind).toBe('unknown');
		});

		test('type guard returns false for invalid / unrelated values', () => {
			expect(isUniqueConstraintError(null)).toBe(false);
			expect(isUniqueConstraintError(undefined)).toBe(false);
			expect(isUniqueConstraintError('error')).toBe(false);
			expect(isUniqueConstraintError(new Error('plain error'))).toBe(false);
			expect(isConstraintError(new DrizzleError())).toBe(false);
		});
	});

	describe('Live Driver Integration (better-sqlite3)', () => {
		const users = sqliteTable('test_users', {
			id: integer('id').primaryKey({ autoIncrement: true }),
			email: text('email').notNull().unique(),
			name: text('name').notNull(),
			age: integer('age').notNull(),
		}, (t) => [
			check('age_check', check`age >= 0`),
		]);

		const posts = sqliteTable('test_posts', {
			id: integer('id').primaryKey({ autoIncrement: true }),
			userId: integer('user_id').references(() => users.id),
		});

		function setupDb() {
			const client = new Database(':memory:');
			client.pragma('foreign_keys = ON');
			client.exec(`
				CREATE TABLE test_users (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					email TEXT NOT NULL UNIQUE,
					name TEXT NOT NULL,
					age INTEGER NOT NULL CHECK (age >= 0)
				);
				CREATE TABLE test_posts (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					user_id INTEGER REFERENCES test_users(id)
				);
			`);
			const db = drizzle(client);
			return { client, db };
		}

		test('throws UniqueConstraintError on duplicate key in run()', () => {
			const { client, db } = setupDb();
			try {
				db.insert(users).values({ email: 'a@example.com', name: 'Alice', age: 20 }).run();
				expect(() => {
					db.insert(users).values({ email: 'a@example.com', name: 'Duplicate', age: 25 }).run();
				}).toThrowError(UniqueConstraintError);

				try {
					db.insert(users).values({ email: 'a@example.com', name: 'Duplicate', age: 25 }).run();
				} catch (e) {
					expect(e).toBeInstanceOf(UniqueConstraintError);
					expect(e).toBeInstanceOf(DrizzleConstraintError);
					expect(e).toBeInstanceOf(DrizzleQueryError);
					expect(isUniqueConstraintError(e)).toBe(true);
					expect(isConstraintError(e)).toBe(true);
					expect(isDrizzleQueryError(e)).toBe(true);
					const uq = e as UniqueConstraintError;
					expect(uq.kind).toBe('unique_constraint');
					expect(uq.table).toBe('test_users');
					expect(uq.column).toBe('email');
				}
			} finally {
				client.close();
			}
		});

		test('throws NotNullConstraintError on missing not-null column in run()', () => {
			const { client, db } = setupDb();
			try {
				expect(() => {
					db.insert(users).values({ email: 'b@example.com', name: null as any, age: 30 }).run();
				}).toThrowError(NotNullConstraintError);

				try {
					db.insert(users).values({ email: 'b@example.com', name: null as any, age: 30 }).run();
				} catch (e) {
					expect(e).toBeInstanceOf(NotNullConstraintError);
					expect(isNotNullConstraintError(e)).toBe(true);
					const nn = e as NotNullConstraintError;
					expect(nn.kind).toBe('not_null_constraint');
					expect(nn.table).toBe('test_users');
					expect(nn.column).toBe('name');
				}
			} finally {
				client.close();
			}
		});

		test('throws CheckConstraintError on check constraint violation in run()', () => {
			const { client, db } = setupDb();
			try {
				expect(() => {
					db.insert(users).values({ email: 'c@example.com', name: 'Charlie', age: -5 }).run();
				}).toThrowError(CheckConstraintError);

				try {
					db.insert(users).values({ email: 'c@example.com', name: 'Charlie', age: -5 }).run();
				} catch (e) {
					expect(e).toBeInstanceOf(CheckConstraintError);
					expect(isCheckConstraintError(e)).toBe(true);
					const cc = e as CheckConstraintError;
					expect(cc.kind).toBe('check_constraint');
				}
			} finally {
				client.close();
			}
		});

		test('throws ForeignKeyConstraintError on fk violation in run()', () => {
			const { client, db } = setupDb();
			try {
				expect(() => {
					db.insert(posts).values({ userId: 9999 }).run();
				}).toThrowError(ForeignKeyConstraintError);

				try {
					db.insert(posts).values({ userId: 9999 }).run();
				} catch (e) {
					expect(e).toBeInstanceOf(ForeignKeyConstraintError);
					expect(isForeignKeyConstraintError(e)).toBe(true);
					const fk = e as ForeignKeyConstraintError;
					expect(fk.kind).toBe('foreign_key_constraint');
				}
			} finally {
				client.close();
			}
		});

		test('throws typed errors in all() and get()', () => {
			const { client, db } = setupDb();
			try {
				// A SELECT that throws at runtime (e.g. invalid query or custom error)
				expect(() => {
					db.all(sql`SELECT * FROM nonexistent_table`);
				}).toThrowError(DrizzleQueryError);
			} finally {
				client.close();
			}
		});
	});
});
