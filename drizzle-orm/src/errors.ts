import { entityKind, is } from '~/entity.ts';

export class DrizzleError extends Error {
	static readonly [entityKind]: string = 'DrizzleError';

	constructor({ message, cause }: { message?: string; cause?: unknown } = {}) {
		super(message);
		this.name = 'DrizzleError';
		this.cause = cause;
	}
}

export type DrizzleQueryErrorKind =
	| 'unique_constraint'
	| 'foreign_key_constraint'
	| 'not_null_constraint'
	| 'check_constraint'
	| 'unknown';

export interface DrizzleQueryErrorInfo {
	kind: DrizzleQueryErrorKind;
	code?: string | number;
	constraint?: string;
	table?: string;
	column?: string;
	detail?: string;
	schema?: string;
}

export function parseDatabaseError(cause?: unknown): DrizzleQueryErrorInfo {
	if (!cause || typeof cause !== 'object') {
		return { kind: 'unknown' };
	}

	const err = cause as Record<string, unknown>;
	const code = (err['code'] ?? err['errno']) as string | number | undefined;
	const codeStr = String(code ?? '');
	const message = typeof err['message'] === 'string'
		? err['message']
		: typeof err['sqlMessage'] === 'string'
		? err['sqlMessage']
		: '';
	let detail = typeof err['detail'] === 'string' ? err['detail'] : undefined;
	let constraint = (err['constraint'] ?? err['constraint_name']) as string | undefined;
	let table = (err['table'] ?? err['table_name']) as string | undefined;
	let column = (err['column'] ?? err['column_name']) as string | undefined;
	const schema = (err['schema'] ?? err['schema_name']) as string | undefined;

	// 1. PostgreSQL SQLSTATE codes (pg, postgres.js, neon, pglite, vercel)
	if (codeStr === '23505') {
		if (!column && detail) {
			const keyMatch = detail.match(/Key \(([^)]+)\)=/);
			if (keyMatch) {
				column = keyMatch[1];
			}
		}
		return { kind: 'unique_constraint', code, constraint, table, column, detail, schema };
	}

	if (codeStr === '23503') {
		if (!table && detail) {
			const tableMatch = detail.match(/(?:in|from) table "([^"]+)"/);
			if (tableMatch) {
				table = tableMatch[1];
			}
		}
		if (!column && detail) {
			const keyMatch = detail.match(/Key \(([^)]+)\)=/);
			if (keyMatch) {
				column = keyMatch[1];
			}
		}
		return { kind: 'foreign_key_constraint', code, constraint, table, column, detail, schema };
	}

	if (codeStr === '23502') {
		return { kind: 'not_null_constraint', code, constraint, table, column, detail, schema };
	}

	if (codeStr === '23514' || codeStr === '23P01') {
		return { kind: 'check_constraint', code, constraint, table, column, detail, schema };
	}

	// 2. MySQL / SingleStore (mysql2, planetscale)
	if (codeStr === 'ER_DUP_ENTRY' || code === 1062) {
		const match = message.match(/Duplicate entry '(.*?)' for key '(?:(.*?)\.)?([^']+)'/);
		return {
			kind: 'unique_constraint',
			code,
			constraint: match ? match[3] : constraint,
			detail: match ? match[1] : detail,
			table: match ? match[2] : table,
			column,
			schema,
		};
	}

	if (
		codeStr === 'ER_NO_REFERENCED_ROW_2' || codeStr === 'ER_NO_REFERENCED_ROW'
		|| codeStr === 'ER_ROW_IS_REFERENCED_2' || codeStr === 'ER_ROW_IS_REFERENCED'
		|| code === 1451 || code === 1452 || code === 1216 || code === 1217
	) {
		const fkMatch = message.match(/CONSTRAINT `([^`]+)` FOREIGN KEY \(`([^`]+)`\)/);
		const tableMatch = message.match(/fails \(`(?:[^`]+)`\.`([^`]+)`/);
		return {
			kind: 'foreign_key_constraint',
			code,
			constraint: fkMatch ? fkMatch[1] : constraint,
			column: fkMatch ? fkMatch[2] : column,
			table: tableMatch ? tableMatch[1] : table,
			detail,
			schema,
		};
	}

	if (codeStr === 'ER_BAD_NULL_ERROR' || code === 1048) {
		const match = message.match(/Column '([^']+)' cannot be null/);
		return {
			kind: 'not_null_constraint',
			code,
			column: match ? match[1] : column,
			constraint,
			table,
			detail,
			schema,
		};
	}

	if (codeStr === 'ER_CHECK_CONSTRAINT_VIOLATED' || code === 3819) {
		const match = message.match(/Check constraint '([^']+)' is violated/);
		return {
			kind: 'check_constraint',
			code,
			constraint: match ? match[1] : constraint,
			table,
			column,
			detail,
			schema,
		};
	}

	// 3. SQLite (better-sqlite3, libsql, bun:sqlite, d1, sql-js)
	if (
		codeStr === 'SQLITE_CONSTRAINT_UNIQUE' || codeStr === 'SQLITE_CONSTRAINT_PRIMARYKEY'
		|| code === 2067 || code === 1555
		|| message.includes('UNIQUE constraint failed') || message.includes('PRIMARY KEY must be unique')
	) {
		const match = message.match(/UNIQUE constraint failed:\s*(?:([^\s,.]+)\.)?([^\s,]+)/);
		return {
			kind: 'unique_constraint',
			code: code ?? 'SQLITE_CONSTRAINT_UNIQUE',
			table: match ? match[1] : table,
			column: match ? match[2] : column,
			constraint,
			detail,
			schema,
		};
	}

	if (
		codeStr === 'SQLITE_CONSTRAINT_FOREIGNKEY' || code === 787
		|| message.includes('FOREIGN KEY constraint failed')
	) {
		return {
			kind: 'foreign_key_constraint',
			code: code ?? 'SQLITE_CONSTRAINT_FOREIGNKEY',
			constraint,
			table,
			column,
			detail,
			schema,
		};
	}

	if (
		codeStr === 'SQLITE_CONSTRAINT_NOTNULL' || code === 1299
		|| message.includes('NOT NULL constraint failed')
	) {
		const match = message.match(/NOT NULL constraint failed:\s*(?:([^\s,.]+)\.)?([^\s,]+)/);
		return {
			kind: 'not_null_constraint',
			code: code ?? 'SQLITE_CONSTRAINT_NOTNULL',
			table: match ? match[1] : table,
			column: match ? match[2] : column,
			constraint,
			detail,
			schema,
		};
	}

	if (
		codeStr === 'SQLITE_CONSTRAINT_CHECK' || code === 275
		|| message.includes('CHECK constraint failed')
	) {
		const match = message.match(/CHECK constraint failed:\s*(.+)/);
		return {
			kind: 'check_constraint',
			code: code ?? 'SQLITE_CONSTRAINT_CHECK',
			constraint: match && match[1] ? match[1].trim() : constraint,
			table,
			column,
			detail,
			schema,
		};
	}

	// 4. Generic string message fallbacks
	const lowerMsg = message.toLowerCase();
	if (lowerMsg.includes('unique constraint') || lowerMsg.includes('duplicate key')) {
		return { kind: 'unique_constraint', code, constraint, table, column, detail, schema };
	}
	if (lowerMsg.includes('foreign key constraint') || lowerMsg.includes('foreign key')) {
		return { kind: 'foreign_key_constraint', code, constraint, table, column, detail, schema };
	}
	if (
		lowerMsg.includes('not-null constraint') || lowerMsg.includes('not null constraint')
		|| lowerMsg.includes('cannot be null')
	) {
		return { kind: 'not_null_constraint', code, constraint, table, column, detail, schema };
	}
	if (lowerMsg.includes('check constraint')) {
		return { kind: 'check_constraint', code, constraint, table, column, detail, schema };
	}

	return { kind: 'unknown', code, constraint, table, column, detail, schema };
}

export class DrizzleQueryError extends DrizzleError {
	static override readonly [entityKind]: string = 'DrizzleQueryError';

	public readonly query!: string;
	public readonly params!: unknown[];
	public readonly kind!: DrizzleQueryErrorKind;
	public readonly code?: string | number;
	public readonly constraint?: string;
	public readonly table?: string;
	public readonly column?: string;
	public readonly detail?: string;
	public readonly schema?: string;

	constructor(
		query: string,
		params: unknown[],
		cause?: unknown,
		parsedInfo?: DrizzleQueryErrorInfo,
	) {
		const parsed = parsedInfo ?? parseDatabaseError(cause);

		// If called as generic DrizzleQueryError, instantiate the specific subclass when kind is known
		if (new.target === DrizzleQueryError) {
			if (parsed.kind === 'unique_constraint') {
				return new UniqueConstraintError(query, params, cause, parsed);
			}
			if (parsed.kind === 'foreign_key_constraint') {
				return new ForeignKeyConstraintError(query, params, cause, parsed);
			}
			if (parsed.kind === 'not_null_constraint') {
				return new NotNullConstraintError(query, params, cause, parsed);
			}
			if (parsed.kind === 'check_constraint') {
				return new CheckConstraintError(query, params, cause, parsed);
			}
		}

		super({ message: `Failed query: ${query}\nparams: ${params}`, cause });
		this.name = 'DrizzleQueryError';
		if (Error.captureStackTrace) {
			Error.captureStackTrace(this, new.target);
		}

		this.query = query;
		this.params = params;
		this.kind = parsed.kind;
		this.code = parsed.code;
		this.constraint = parsed.constraint;
		this.table = parsed.table;
		this.column = parsed.column;
		this.detail = parsed.detail;
		this.schema = parsed.schema;
	}

	isConstraint(): this is DrizzleConstraintError {
		return this.kind !== 'unknown';
	}

	isUniqueConstraint(): this is UniqueConstraintError {
		return this.kind === 'unique_constraint';
	}

	isForeignKeyConstraint(): this is ForeignKeyConstraintError {
		return this.kind === 'foreign_key_constraint';
	}

	isNotNullConstraint(): this is NotNullConstraintError {
		return this.kind === 'not_null_constraint';
	}

	isCheckConstraint(): this is CheckConstraintError {
		return this.kind === 'check_constraint';
	}
}

export class DrizzleConstraintError extends DrizzleQueryError {
	static override readonly [entityKind]: string = 'DrizzleConstraintError';

	constructor(
		query: string,
		params: unknown[],
		cause?: unknown,
		parsed?: DrizzleQueryErrorInfo,
	) {
		super(query, params, cause, parsed);
		this.name = 'DrizzleConstraintError';
	}
}

export class UniqueConstraintError extends DrizzleConstraintError {
	static override readonly [entityKind]: string = 'UniqueConstraintError';
	override readonly kind = 'unique_constraint' as const;

	constructor(query: string, params: unknown[], cause?: unknown, parsed?: DrizzleQueryErrorInfo) {
		super(
			query,
			params,
			cause,
			parsed ?? { ...parseDatabaseError(cause), kind: 'unique_constraint' },
		);
		this.name = 'UniqueConstraintError';
	}
}

export class ForeignKeyConstraintError extends DrizzleConstraintError {
	static override readonly [entityKind]: string = 'ForeignKeyConstraintError';
	override readonly kind = 'foreign_key_constraint' as const;

	constructor(query: string, params: unknown[], cause?: unknown, parsed?: DrizzleQueryErrorInfo) {
		super(
			query,
			params,
			cause,
			parsed ?? { ...parseDatabaseError(cause), kind: 'foreign_key_constraint' },
		);
		this.name = 'ForeignKeyConstraintError';
	}
}

export class NotNullConstraintError extends DrizzleConstraintError {
	static override readonly [entityKind]: string = 'NotNullConstraintError';
	override readonly kind = 'not_null_constraint' as const;

	constructor(query: string, params: unknown[], cause?: unknown, parsed?: DrizzleQueryErrorInfo) {
		super(
			query,
			params,
			cause,
			parsed ?? { ...parseDatabaseError(cause), kind: 'not_null_constraint' },
		);
		this.name = 'NotNullConstraintError';
	}
}

export class CheckConstraintError extends DrizzleConstraintError {
	static override readonly [entityKind]: string = 'CheckConstraintError';
	override readonly kind = 'check_constraint' as const;

	constructor(query: string, params: unknown[], cause?: unknown, parsed?: DrizzleQueryErrorInfo) {
		super(
			query,
			params,
			cause,
			parsed ?? { ...parseDatabaseError(cause), kind: 'check_constraint' },
		);
		this.name = 'CheckConstraintError';
	}
}

export class TransactionRollbackError extends DrizzleError {
	static override readonly [entityKind]: string = 'TransactionRollbackError';

	constructor() {
		super({ message: 'Rollback' });
		this.name = 'TransactionRollbackError';
	}
}

// Aliases
export {
	CheckConstraintError as DrizzleCheckConstraintError,
	ForeignKeyConstraintError as DrizzleForeignKeyConstraintError,
	NotNullConstraintError as DrizzleNotNullConstraintError,
	UniqueConstraintError as DrizzleUniqueConstraintError,
};

// Type guards
export function isDrizzleError(value: unknown): value is DrizzleError {
	return is(value, DrizzleError);
}

export function isDrizzleQueryError(value: unknown): value is DrizzleQueryError {
	return is(value, DrizzleQueryError);
}

export function isConstraintError(value: unknown): value is DrizzleConstraintError {
	return is(value, DrizzleConstraintError);
}

export const isDrizzleConstraintError = isConstraintError;

export function isUniqueConstraintError(value: unknown): value is UniqueConstraintError {
	return is(value, UniqueConstraintError);
}

export function isForeignKeyConstraintError(value: unknown): value is ForeignKeyConstraintError {
	return is(value, ForeignKeyConstraintError);
}

export function isNotNullConstraintError(value: unknown): value is NotNullConstraintError {
	return is(value, NotNullConstraintError);
}

export function isCheckConstraintError(value: unknown): value is CheckConstraintError {
	return is(value, CheckConstraintError);
}
