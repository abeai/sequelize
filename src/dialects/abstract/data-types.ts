import util from 'util';
import isEqual from 'lodash/isEqual';
import isObject from 'lodash/isObject';
import isPlainObject from 'lodash/isPlainObject';
import moment from 'moment';
import momentTz from 'moment-timezone';
import wkx from 'wkx';
import { kSetDialectNames } from '../../dialect-toolbox';
import { ValidationError } from '../../errors';
import type { Falsy } from '../../generic/falsy';
import { classToInvokable } from '../../utils/class-to-invokable';
import { joinSQLFragments } from '../../utils/join-sql-fragments';
import { logger } from '../../utils/logger';
import { validator as Validator } from '../../utils/validator-extras';

const printedWarnings = new Set<string>();

// If T is a constructor, returns the type of what `new T()` would return,
// otherwise, returns T
export type Constructed<T> = T extends abstract new () => infer Instance
  ? Instance
  : T;

export type AcceptableTypeOf<T extends DataType> =
  Constructed<T> extends AbstractDataType<infer Acceptable> ? Acceptable : never;

export type DataType<T extends AbstractDataType<any> = AbstractDataType<any>> =
  | T
  | { key: string, new (): T };

// TODO: This typing may not be accurate, validate when query-generator is typed.
export interface StringifyOptions {
  escape(str: string): string;
  operation?: string;
  timezone?: string;
  // TODO: Update this when query-generator is converted to TS
  field?: any;
}

// TODO: This typing may not be accurate, validate when query-generator is typed.
export interface BindParamOptions extends StringifyOptions {
  bindParam(value: string | Buffer | string[] | null): string;
}

export type DialectTypeMeta =
  | {
      subtypes: { [name: string]: string },
      castTypes: { [name: string]: string },
    }
  | string[]
  | number[]
  | [null]
  | false;

export abstract class AbstractDataType<
  /** The type of value we'll accept - ie for a column of this type, we'll accept this value as user input. */
  AcceptedType,
> {
  /** @internal */
  public static readonly types: Record<string, DialectTypeMeta>;
  /** @internal */
  public types!: Record<string, DialectTypeMeta>;

  declare readonly key: string;

  /**
   * Helper used to add a dialect to `types` of a DataType.  It ensures that it doesn't modify the types of its parent.
   *
   * @param dialect The dialect the types apply to
   * @param types The dialect-specific types.
   */
  // TODO: move to utils
  public static [kSetDialectNames](dialect: string, types: DialectTypeMeta) {
    if (!Object.prototype.hasOwnProperty.call(this, 'types')) {
      const prop = {
        value: {},
        writable: false,
        enumerable: false,
        configurable: false,
      };

      // TODO: remove the version on prototype, or add a getter instead
      Reflect.defineProperty(this, 'types', prop);
      Reflect.defineProperty(this.prototype, 'types', prop);
    }

    this.types[dialect] = types;
  }

  public static get key() {
    throw new Error('Do not try to get the "key" static property on data types, get it on the instance instead.');
  }

  public static get escape() {
    throw new Error('Do not try to get the "escape" static property on data types, get it on the instance instead.');
  }

  declare readonly escape: boolean | ((str: string, opts: StringifyOptions) => string);

  // TODO: move to utils?
  protected _construct<Constructor extends abstract new () => AbstractDataType<any>>(
    ...args: ConstructorParameters<Constructor>): this {
    const constructor = this.constructor as new (
      ..._args: ConstructorParameters<Constructor>
    ) => this;

    return new constructor(...args);
  }

  dialectTypes = '';

  protected areValuesEqual(
    value: AcceptedType,
    originalValue: AcceptedType,
  ): boolean {
    return isEqual(value, originalValue);
  }

  /**
   * Used to normalize a value when {@link Model#set} is called. Typically, when retrieved from the database, but
   * also when called by the user manually.
   *
   * @param value
   * @param _options
   * @param _options.raw
   */
  sanitize(value: unknown, _options?: { raw?: true }): unknown {
    return value;
  }

  /**
   * Checks whether the JS value is compatible with (or can be converted to) the SQL data type.
   * Throws if that is not the case.
   *
   * @param value
   */
  validate(value: any): asserts value is AcceptedType {}

  /**
   * Converts a JS value to a SQL value, compatible with the SQL data type
   *
   * @param value
   * @param _options
   * @protected
   */
  stringify(value: AcceptedType, _options: StringifyOptions): string {
    return String(value);
  }

  /**
   * Transforms a value before adding it to the list of bind parameters of a query.
   *
   * @param value
   * @param options
   */
  bindParam(value: AcceptedType, options: BindParamOptions): string {
    return options.bindParam(String(value));
  }

  toString(options: StringifyOptions): string {
    return this.toSql(options);
  }

  // TODO: rename to 'toSqlDataType'
  /**
   * Returns a SQL declaration of this data type.
   * e.g. 'VARCHAR(255)', 'TEXT', etc…
   *
   * @param _options
   */
  toSql(_options: StringifyOptions): string {
    // this is defiend via
    if (!this.key) {
      throw new TypeError('Expected a key property to be defined');
    }

    return this.key ?? '';
  }

  static toString() {
    return this.name;
  }

  // TODO: move to utils
  static warn(link: string, text: string) {
    if (printedWarnings.has(text)) {
      return;
    }

    printedWarnings.add(text);
    logger.warn(`${text} \n>> Check: ${link}`);
  }

  // TODO: move to utils
  static extend<A, Options>(
    this: new (options: Options) => AbstractDataType<A>,
    oldType: AbstractDataType<A> & { options: Options },
  ) {
    return new this(oldType.options);
  }

  // TODO: move to utils
  static isType(value: any): value is DataType {
    if (value.prototype && value.prototype instanceof AbstractDataType) {
      return true;
    }

    return value instanceof AbstractDataType;
  }
}

interface StringTypeOptions {
  /**
   * @default 255
   */
  length?: number | undefined;

  /**
   * @default false
   */
  binary?: boolean;
}

/**
 * STRING A variable length string
 */
@classToInvokable
class STRING extends AbstractDataType<string | Buffer> {
  readonly key: string = 'STRING';
  readonly options: StringTypeOptions;

  constructor(length: number, binary?: boolean);
  constructor(options?: StringTypeOptions);
  constructor(lengthOrOptions?: number | StringTypeOptions, binary?: boolean) {
    super();

    if (isObject(lengthOrOptions)) {
      this.options = {
        length: lengthOrOptions.length ?? 255,
        binary: lengthOrOptions.binary ?? false,
      };
    } else {
      this.options = {
        length: lengthOrOptions ?? 255,
        binary: binary ?? false,
      };
    }

    Object.freeze(this.options);
  }

  public toSql() {
    return joinSQLFragments([
      `VAR_CHAR(${this.options.length})`,
      this.options.binary && 'BINARY',
    ]);
  }

  public validate(value: any): asserts value is string | Buffer {
    if (typeof value === 'string') {
      return;
    }

    if (
      (this.options.binary && Buffer.isBuffer(value))
        || typeof value === 'number'
    ) {
      return;
    }

    throw new ValidationError(
      util.format('%j is not a valid string', value),
      [],
    );
  }

  get BINARY() {
    return this._construct<typeof STRING>({
      ...this.options,
      binary: true,
    });
  }

  static get BINARY() {
    return new this({ binary: true });
  }
}

/**
 * CHAR A fixed length string
 */
@classToInvokable
class CHAR extends STRING {
  readonly key = 'CHAR';
  public toSql() {
    return joinSQLFragments([
      `CHAR(${this.options.length})`,
      this.options.binary && 'BINARY',
    ]);
  }
}

const validTextLengths = ['tiny', 'medium', 'long'];
export type TextLength = 'tiny' | 'medium' | 'long';

interface TextOptions {
  length?: TextLength;
}

/**
 * Unlimited length TEXT column
 */
@classToInvokable
class TEXT extends AbstractDataType<string> {
  readonly key = 'TEXT';
  readonly options: TextOptions;

  /**
   * @param lengthOrOptions could be tiny, medium, long.
   */
  constructor(lengthOrOptions?: TextLength | TextOptions) {
    super();

    const length = (typeof lengthOrOptions === 'object' ? lengthOrOptions.length : lengthOrOptions)?.toLowerCase();

    if (length != null && !validTextLengths.includes(length)) {
      throw new TypeError(`If specified, the "length" option must be one of: ${validTextLengths.join(', ')}`);
    }

    this.options = {
      length: length as TextLength,
    };
  }

  toSql() {
    switch (this.options.length) {
      case 'tiny':
        return 'TINY_TEXT';
      case 'medium':
        return 'MEDIUM_TEXT';
      case 'long':
        return 'LONG_TEXT';
      default:
        return this.key;
    }
  }

  public validate(value: any): asserts value is string {
    if (typeof value !== 'string') {
      throw new ValidationError(
        util.format('%j is not a valid string', value),
        [],
      );
    }
  }
}

/**
 * An unlimited length case-insensitive text column.
 * Original case is preserved but acts case-insensitive when comparing values (such as when finding or unique constraints).
 * Only available in Postgres and SQLite.
 */
@classToInvokable
class CITEXT extends AbstractDataType<string> {
  readonly key = 'CITEXT';

  public validate(value: any): asserts value is string {
    if (typeof value !== 'string') {
      throw new ValidationError(
        util.format('%j is not a valid string', value),
        [],
      );
    }
  }
}

export interface NumberOptions {
  // TODO: it's not length + decimals if only 1 parameter is provided
  /**
   * length of type, like `INT(4)`
   */
  length?: number;

  /**
   * number of decimal points, used with length `FLOAT(5, 4)`
   */
  decimals?: number;

  /**
   * Is zero filled?
   */
  zerofill?: boolean;

  /**
   * Is unsigned?
   */
  unsigned?: boolean;
}

type AcceptedNumber =
  | number
  | boolean
  | string
  | null;

/**
 * Base number type which is used to build other types
 */
@classToInvokable
class NUMBER<Options extends NumberOptions = NumberOptions> extends AbstractDataType<AcceptedNumber> {
  readonly key: string = 'NUMBER';

  protected options: Options;

  constructor(optionsOrLength?: number | Readonly<Options>) {
    super();

    if (isObject(optionsOrLength)) {
      this.options = { ...optionsOrLength };
    } else {
      // @ts-expect-error
      this.options = { length: optionsOrLength };
    }
  }

  toSql(): string {
    let result = this.key;

    if (this.options.length) {
      result += `(${this.options.length}`;
      if (typeof this.options.decimals === 'number') {
        result += `,${this.options.decimals}`;
      }

      result += ')';
    }

    if (this.options.unsigned) {
      result += ' UNSIGNED';
    }

    if (this.options.zerofill) {
      result += ' ZEROFILL';
    }

    return result;
  }

  validate(value: any): asserts value is number {
    if (!Validator.isFloat(String(value))) {
      throw new ValidationError(
        util.format(
          `%j is not a valid ${super
            .toString({
              escape(str) {
                return str;
              },
            })
            .toLowerCase()}`,
          value,
        ),
        [],
      );
    }
  }

  stringify(number: AcceptedNumber): string {
    // This should be unnecessary but since this directly returns the passed string its worth the added validation.
    this.validate(number);

    return String(number);
  }

  get UNSIGNED() {
    return this._construct<typeof NUMBER>({ ...this.options, unsigned: true });
  }

  get ZEROFILL() {
    return this._construct<typeof NUMBER>({ ...this.options, zerofill: true });
  }

  static get UNSIGNED() {
    return new this({ unsigned: true });
  }

  static get ZEROFILL() {
    return new this({ zerofill: true });
  }
}

/**
 * A 32 bit integer
 */
@classToInvokable
class INTEGER extends NUMBER {
  readonly key: string = 'INTEGER';

  public validate(value: any) {
    if (!Validator.isInt(String(value))) {
      throw new ValidationError(
        util.format(`%j is not a valid ${this.key.toLowerCase()}`, value),
        [],
      );
    }
  }
}

/**
 * A 8 bit integer
 */
@classToInvokable
class TINYINT extends INTEGER {
  readonly key = 'TINYINT';
}

/**
 * A 16 bit integer
 */
@classToInvokable
class SMALLINT extends INTEGER {
  readonly key = 'SMALLINT';
}

/**
 * A 24 bit integer
 */
@classToInvokable
class MEDIUMINT extends INTEGER {
  readonly key = 'MEDIUMINT';
}

/**
 * A 64 bit integer
 */
@classToInvokable
class BIGINT extends INTEGER {
  readonly key = 'BIGINT';
}

/**
 * Floating point number (4-byte precision).
 */
@classToInvokable
class FLOAT extends NUMBER {
  readonly key: string = 'FLOAT';
  readonly escape = false;

  constructor(options?: NumberOptions);

  // TODO: the description of length is not accurate
  //  mysql/mariadb: float(M,D) M is the total number of digits and D is the number of digits following the decimal point.
  //  postgres/mssql: float(P) is the precision
  /**
   * @param length length of type, like `FLOAT(4)`
   * @param decimals number of decimal points, used with length `FLOAT(5, 4)`
   */
  constructor(length: number, decimals?: number);
  constructor(length?: number | NumberOptions, decimals?: number) {
    super(typeof length === 'object' ? length : { length, decimals });
  }

  validate(value: any): asserts value is AcceptedNumber {
    if (!Validator.isFloat(String(value))) {
      throw new ValidationError(
        util.format('%j is not a valid float', value),
        [],
      );
    }
  }

  _value(value: AcceptedNumber) {
    const num = typeof value === 'number' ? value : Number(String(value));

    if (Number.isNaN(num)) {
      return 'NaN';
    }

    if (!Number.isFinite(num)) {
      const sign = num < 0 ? '-' : '';

      return `${sign}Infinity`;
    }

    return num.toString();
  }

  stringify(value: AcceptedNumber) {
    this.validate(value);

    return `'${this._value(value)}'`;
  }

  bindParam(value: AcceptedNumber, options: BindParamOptions) {
    return options.bindParam(this._value(value));
  }
}

@classToInvokable
class REAL extends FLOAT {
  readonly key = 'REAL';
}

/**
 * Floating point number (8-byte precision).
 */
@classToInvokable
class DOUBLE extends FLOAT {
  readonly key = 'DOUBLE';
}

interface DecimalOptions extends NumberOptions {
  scale?: number;
  precision?: number;
}

/**
 * Decimal type, variable precision, take length as specified by user
 */
@classToInvokable
class DECIMAL extends NUMBER<DecimalOptions> {
  readonly key = 'DECIMAL';

  constructor(options?: DecimalOptions);
  /**
   * @param precision defines precision
   * @param scale defines scale
   */
  constructor(precision: number, scale?: number);
  constructor(precisionOrOptions?: number | DecimalOptions, scale?: number) {
    if (isObject(precisionOrOptions)) {
      super(precisionOrOptions);
    } else {
      super();

      this.options.precision = precisionOrOptions;
      this.options.scale = scale;
    }
  }

  toSql() {
    if (this.options.precision || this.options.scale) {
      return `DECIMAL(${[this.options.precision, this.options.scale]
        .filter(num => num != null)
        .join(',')})`;
    }

    return 'DECIMAL';
  }

  validate(value: any): asserts value is AcceptedNumber {
    if (!Validator.isDecimal(String(value))) {
      throw new ValidationError(
        util.format('%j is not a valid decimal', value),
        [],
      );
    }
  }
}

/**
 * A boolean / tinyint column, depending on dialect
 */
@classToInvokable
class BOOLEAN extends AbstractDataType<boolean | Falsy> {
  readonly key = 'BOOLEAN';

  toSql() {
    // Note: This may vary depending on the dialect.
    return 'TINYINT(1)';
  }

  validate(value: any): asserts value is boolean {
    if (!Validator.isBoolean(String(value))) {
      throw new ValidationError(
        util.format('%j is not a valid boolean', value),
        [],
      );
    }
  }

  sanitize(value: unknown): boolean | null {
    return BOOLEAN.parse(value);
  }

  static parse(value: unknown): boolean | null {
    if (value == null) {
      return null;
    }

    if (Buffer.isBuffer(value) && value.length === 1) {
      // Bit fields are returned as buffers
      value = value[0];
    }

    const type = typeof value;
    if (type === 'string') {
      // Only take action on valid boolean strings.
      if (value === 'true') {
        return true;
      }

      if (value === 'false') {
        return false;
      }
    } else if (
      type === 'number' // Only take action on valid boolean integers.
      && (value === 0 || value === 1)
    ) {
      return Boolean(value);
    }

    return null;
  }
}

/**
 * A time column
 */
@classToInvokable
class TIME extends AbstractDataType<Date | string | number> {
  readonly key = 'TIME';

  toSql() {
    return 'TIME';
  }
}

interface DateOptions {
  /**
   * The precision of the date.
   */
  length?: string | number;
}

type RawDate = Date | string | number;
type AcceptedDate = RawDate | moment.Moment;

/**
 * A date and time.
 */
@classToInvokable
class DATE extends AbstractDataType<AcceptedDate> {
  readonly key: string = 'DATE';
  readonly options: DateOptions;

  /**
   * @param lengthOrOptions precision to allow storing milliseconds
   */
  constructor(lengthOrOptions?: number | DateOptions) {
    super();

    this.options = {
      length: typeof lengthOrOptions === 'object' ? lengthOrOptions.length : lengthOrOptions,
    };
  }

  toSql() {
    return 'DATETIME';
  }

  validate(value: any) {
    if (!Validator.isDate(String(value))) {
      throw new ValidationError(
        util.format('%j is not a valid date', value),
        [],
      );
    }

    return true;
  }

  sanitize(value: unknown, options?: { raw?: boolean }): unknown {
    if (options?.raw) {
      return value;
    }

    if (value instanceof Date) {
      return value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return new Date(value);
    }

    throw new TypeError(`${value} cannot be converted to a date`);
  }

  areValuesEqual(
    value: AcceptedDate,
    originalValue: AcceptedDate,
  ): boolean {
    if (
      originalValue
      && Boolean(value)
      && (value === originalValue
        || (value instanceof Date
          && originalValue instanceof Date
          && value.getTime() === originalValue.getTime()))
    ) {
      return true;
    }

    // not changed when set to same empty value
    if (!originalValue && !value && originalValue === value) {
      return true;
    }

    return false;
  }

  private _applyTimezone(date: AcceptedDate, options: { timezone?: string }) {
    if (options.timezone) {
      if (momentTz.tz.zone(options.timezone)) {
        return momentTz(date).tz(options.timezone);
      }

      return moment(date).utcOffset(options.timezone);
    }

    return momentTz(date);
  }

  stringify(
    date: AcceptedDate,
    options: { timezone?: string } = {},
  ) {
    if (!moment.isMoment(date)) {
      date = this._applyTimezone(date, options);
    }

    // Z here means current timezone, *not* UTC
    return date.format('YYYY-MM-DD HH:mm:ss.SSS Z');
  }
}

/**
 * A date only column (no timestamp)
 */
@classToInvokable
class DATEONLY extends AbstractDataType<AcceptedDate> {
  readonly key = 'DATEONLY';

  toSql() {
    return 'DATE';
  }

  stringify(date: AcceptedDate) {
    return moment(date).format('YYYY-MM-DD');
  }

  sanitize(value: unknown, options?: { raw?: boolean }): unknown {
    if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) {
      throw new TypeError(`${value} cannot be normalized into a DateOnly string.`);
    }

    if (!options?.raw && value) {
      return moment(value).format('YYYY-MM-DD');
    }

    return value;
  }

  areValuesEqual(value: AcceptedDate, originalValue: AcceptedDate) {
    if (originalValue && Boolean(value) && originalValue === value) {
      return true;
    }

    // not changed when set to same empty value
    if (!originalValue && !value && originalValue === value) {
      return true;
    }

    return false;
  }
}

/**
 * A key / value store column. Only available in Postgres.
 */
@classToInvokable
class HSTORE extends AbstractDataType<Record<string, unknown>> {
  readonly key = 'HSTORE';

  public validate(value: any) {
    if (!isPlainObject(value)) {
      throw new ValidationError(
        util.format('%j is not a valid hstore, it must be a plain object', value),
        [],
      );
    }
  }
}

/**
 * A JSON string column. Available in MySQL, Postgres and SQLite
 */
@classToInvokable
class JSON extends AbstractDataType<any> {
  readonly key: string = 'JSON';

  stringify(value: any) {
    return globalThis.JSON.stringify(value);
  }
}

/**
 * A binary storage JSON column. Only available in Postgres.
 */
@classToInvokable
class JSONB extends JSON {
  readonly key = 'JSONB';
}

/**
 * A default value of the current timestamp.  Not a valid type.
 */
@classToInvokable
class NOW extends AbstractDataType<never> {
  readonly key = 'NOW';
}

type AcceptedBlob = Buffer | string;

enum BlobLength {
  TINY = 'tiny',
  MEDIUM = 'medium',
  LONG = 'long',
}

interface BlobOptions {
  // TODO: must also allow BLOB(255), BLOB(16M) in db2/ibmi
  length?: BlobLength;
}

/**
 * Binary storage
 */
@classToInvokable
class BLOB extends AbstractDataType<AcceptedBlob> {
  readonly key = 'BLOB';
  readonly escape = false;
  readonly options: BlobOptions;

  /**
   * @param lengthOrOptions could be tiny, medium, long.
   */
  constructor(lengthOrOptions?: BlobLength | BlobOptions) {
    super();

    // TODO: valide input (tiny, medium, long, number, 16M, 2G, etc)

    this.options = {
      length: typeof lengthOrOptions === 'object' ? lengthOrOptions.length : lengthOrOptions,
    };
  }

  toSql() {
    switch (this.options.length) {
      case BlobLength.TINY:
        return 'TINYBLOB';
      case BlobLength.MEDIUM:
        return 'MEDIUMBLOB';
      case BlobLength.LONG:
        return 'LONGBLOB';
      default:
        return this.key;
    }
  }

  validate(value: any) {
    if (typeof value !== 'string' && !Buffer.isBuffer(value)) {
      throw new ValidationError(
        util.format('%j is not a valid blob', value),
        [],
      );
    }
  }

  stringify(value: string | Buffer) {
    const buf
      = typeof value === 'string' ? Buffer.from(value, 'binary') : value;

    const hex = buf.toString('hex');

    return this._hexify(hex);
  }

  protected _hexify(hex: string) {
    return `X'${hex}'`;
  }

  bindParam(value: AcceptedBlob, options: BindParamOptions) {
    return options.bindParam(value);
  }
}

interface RangeOptions<T> {
  subtype?: T;
}

/**
 * Range types are data types representing a range of values of some element type (called the range's subtype).
 * Only available in Postgres. See [the Postgres documentation](http://www.postgresql.org/docs/9.4/static/rangetypes.html) for more details
 */
@classToInvokable
class RANGE<T extends NUMBER | DATE | DATEONLY = INTEGER> extends AbstractDataType<AcceptedNumber> {
  readonly key = 'RANGE';
  protected _subtype: string;

  /**
   * @param subtypeOrOptions A subtype for range, like RANGE(DATE)
   */
  constructor(
    subtypeOrOptions: DataType<T> | RangeOptions<T>,
  ) {
    super();

    const subtypeRaw = (AbstractDataType.isType(subtypeOrOptions) ? subtypeOrOptions : subtypeOrOptions.subtype)
      ?? new INTEGER();

    const subtype = typeof subtypeRaw === 'function'
    ? new subtypeRaw()
    : subtypeRaw;

    this._subtype = subtype.key;
  }

  public validate(value: any) {
    if (!Array.isArray(value)) {
      throw new ValidationError(
        util.format('%j is not a valid range', value),
        [],
      );
    }

    if (value.length !== 2) {
      throw new ValidationError(
        'A range must be an array with two elements',
        [],
      );
    }
  }
}

/**
 * A column storing a unique universal identifier.
 * Use with `UUIDV1` or `UUIDV4` for default values.
 */
@classToInvokable
class UUID extends AbstractDataType<string> {
  readonly key = 'UUID';

  public validate(value: any) {
    if (typeof value !== 'string') {
      throw new ValidationError(
        util.format('%j is not a valid uuid', value),
        [],
      );
    }

    if (!Validator.isUUID(value)) {
      throw new ValidationError(
        util.format('%j is not a valid uuid', value),
        [],
      );
    }

    return true;
  }
}

/**
 * A default unique universal identifier generated following the UUID v1 standard
 */
@classToInvokable
class UUIDV1 extends AbstractDataType<string> {
  readonly key = 'UUIDV1';

  public validate(value: any) {
    if (typeof value !== 'string') {
      throw new ValidationError(
        util.format('%j is not a valid uuid', value),
        [],
      );
    }

    // @ts-expect-error -- the typings for isUUID are missing '1' as a valid uuid version, but its implementation does accept it
    if (!Validator.isUUID(value, 1)) {
      throw new ValidationError(
        util.format('%j is not a valid uuidv1', value),
        [],
      );
    }

    return true;
  }
}

/**
 * A default unique universal identifier generated following the UUID v4 standard
 */
@classToInvokable
class UUIDV4 extends AbstractDataType<string> {
  readonly key = 'UUIDV4';

  public validate(value: any) {
    if (typeof value !== 'string') {
      throw new ValidationError(
        util.format('%j is not a valid uuid', value),
        [],
      );
    }

    if (!Validator.isUUID(value, 4)) {
      throw new ValidationError(
        util.format('%j is not a valid uuidv4', value),
        [],
      );
    }

    return true;
  }
}

/**
 * A virtual value that is not stored in the DB. This could for example be useful if you want to provide a default value in your model that is returned to the user but not stored in the DB.
 *
 * You could also use it to validate a value before permuting and storing it. VIRTUAL also takes a return type and dependency fields as arguments
 * If a virtual attribute is present in `attributes` it will automatically pull in the extra fields as well.
 * Return type is mostly useful for setups that rely on types like GraphQL.
 *
 * @example <caption>Checking password length before hashing it</caption>
 * sequelize.define('user', {
 *   password_hash: DataTypes.STRING,
 *   password: {
 *     type: DataTypes.VIRTUAL,
 *     set: function (val) {
 *        // Remember to set the data value, otherwise it won't be validated
 *        this.setDataValue('password', val);
 *        this.setDataValue('password_hash', this.salt + val);
 *      },
 *      validate: {
 *         isLongEnough: function (val) {
 *           if (val.length < 7) {
 *             throw new Error("Please choose a longer password")
 *          }
 *       }
 *     }
 *   }
 * })
 *
 * # In the above code the password is stored plainly in the password field so it can be validated, but is never stored in the DB.
 *
 * @example <caption>Virtual with dependency fields</caption>
 * {
 *   active: {
 *     type: new DataTypes.VIRTUAL(DataTypes.BOOLEAN, ['createdAt']),
 *     get: function() {
 *       return this.get('createdAt') > Date.now() - (7 * 24 * 60 * 60 * 1000)
 *     }
 *   }
 * }
 *
 */
@classToInvokable
class VIRTUAL<T> extends AbstractDataType<T> {
  readonly key = 'VIRTUAL';

  returnType?: AbstractDataType<T>;
  fields?: string[];

  /**
   * @param [ReturnType] return type for virtual type
   * @param [fields] array of fields this virtual type is dependent on
   */
  constructor(ReturnType?: DataType, fields?: string[]) {
    super();
    if (typeof ReturnType === 'function') {
      ReturnType = new ReturnType();
    }

    this.returnType = ReturnType;
    this.fields = fields;
  }
}

interface EnumOptions<Member extends string> {
  values: Member[];
}

/**
 * An enumeration, Postgres Only
 *
 * @example
 * DataTypes.ENUM('value', 'another value')
 * DataTypes.ENUM(['value', 'another value'])
 * DataTypes.ENUM({
 *   values: ['value', 'another value']
 * });
 */
@classToInvokable
class ENUM<Member extends string> extends AbstractDataType<Member> {
  readonly key = 'ENUM';
  readonly options: EnumOptions<Member>;

  /**
   * @param options either array of values or options object with values array. It also supports variadic values.
   */
  constructor(options: EnumOptions<Member>);
  constructor(members: Member[]);
  constructor(...members: Member[]);
  constructor(...args: [Member[] | Member | EnumOptions<Member>, ...Member[]]) {
    super();

    let values: Member[];
    if (isObject(args[0])) {
      if (args.length > 1) {
        throw new TypeError('DataTypes.ENUM has been constructed incorrectly: Its first parameter is the option bag or the array of values, but more than one parameter has been provided.');
      }

      if (Array.isArray(args[0])) {
        values = args[0];
      } else {
        values = args[0].values;
      }
    } else {
      // @ts-expect-error -- we'll assert in the next line whether this is the right type
      values = args;
    }

    if (values.length === 0) {
      throw new TypeError('DataTypes.ENUM cannot be used without specifying its possible enum values.');
    }

    for (const value of values) {
      if (typeof value !== 'string') {
        throw new TypeError(`One of the possible values passed to DataTypes.ENUM (${String(value)}) is not a string. Only strings can be used as enum values.`);
      }
    }

    this.options = {
      values,
    };
  }

  validate(value: any): asserts value is Member {
    if (!this.options.values.includes(value)) {
      throw new ValidationError(
        util.format('%j is not a valid choice in %j', value, this.options.values),
        [],
      );
    }
  }
}

interface ArrayOptions<T extends AbstractDataType<any>> {
  type: DataType<T>;
}

interface NormalizedArrayOptions<T extends AbstractDataType<any>> {
  type: T;
}

/**
 * An array of `type`. Only available in Postgres.
 *
 * @example
 * DataTypes.ARRAY(DataTypes.DECIMAL)
 */
@classToInvokable
class ARRAY<T extends AbstractDataType<any>> extends AbstractDataType<Array<AcceptableTypeOf<T>>> {
  readonly key = 'ARRAY';
  readonly options: NormalizedArrayOptions<T>;

  /**
   * @param typeOrOptions type of array values
   */
  constructor(typeOrOptions: DataType<T> | ArrayOptions<T>) {
    super();

    const rawType = AbstractDataType.isType(typeOrOptions) ? typeOrOptions : typeOrOptions.type;

    this.options = {
      type: typeof rawType === 'function' ? new rawType() : rawType,
    };
  }

  toSql(options: StringifyOptions) {
    return `${this.options.type.toSql(options)}[]`;
  }

  public validate(value: any) {
    if (!Array.isArray(value)) {
      throw new ValidationError(
        util.format('%j is not a valid array', value),
        [],
      );
    }

    // TODO: validate individual items

    return true;
  }

  static is<T extends AbstractDataType<any>>(
    obj: unknown,
    type: new () => T,
  ): obj is ARRAY<T> {
    return obj instanceof ARRAY && (obj).options.type instanceof type;
  }
}

export type GeometryType = Uppercase<keyof typeof wkx>;

interface GeometryOptions {
  type?: GeometryType;
  srid?: number;
}

/**
 * A column storing Geometry information.
 * It is only available in PostgreSQL (with PostGIS), MariaDB or MySQL.
 *
 * GeoJSON is accepted as input and returned as output.
 *
 * In PostGIS, the GeoJSON is parsed using the PostGIS function `STGeomFromGeoJSON`.
 * In MySQL it is parsed using the function `STGeomFromText`.
 *
 * Therefore, one can just follow the [GeoJSON spec](https://tools.ietf.org/html/rfc7946) for handling geometry objects.  See the following examples:
 *
 * @example <caption>Defining a Geometry type attribute</caption>
 * DataTypes.GEOMETRY
 * DataTypes.GEOMETRY('POINT')
 * DataTypes.GEOMETRY('POINT', 4326)
 *
 * @example <caption>Create a new point</caption>
 * const point = { type: 'Point', coordinates: [-76.984722, 39.807222]}; // GeoJson format: [lng, lat]
 *
 * User.create({username: 'username', geometry: point });
 *
 * @example <caption>Create a new linestring</caption>
 * const line = { type: 'LineString', 'coordinates': [ [100.0, 0.0], [101.0, 1.0] ] };
 *
 * User.create({username: 'username', geometry: line });
 *
 * @example <caption>Create a new polygon</caption>
 * const polygon = { type: 'Polygon', coordinates: [
 *                 [ [100.0, 0.0], [101.0, 0.0], [101.0, 1.0],
 *                   [100.0, 1.0], [100.0, 0.0] ]
 *                 ]};
 *
 * User.create({username: 'username', geometry: polygon });
 *
 * @example <caption>Create a new point with a custom SRID</caption>
 * const point = {
 *   type: 'Point',
 *   coordinates: [-76.984722, 39.807222], // GeoJson format: [lng, lat]
 *   crs: { type: 'name', properties: { name: 'EPSG:4326'} }
 * };
 *
 * User.create({username: 'username', geometry: point })
 *
 *
 * @see {@link DataTypes.GEOGRAPHY}
 */
@classToInvokable
class GEOMETRY extends AbstractDataType<wkx.Geometry | Buffer | string> {
  readonly key: string = 'GEOMETRY';
  readonly escape = false;
  readonly options: GeometryOptions;

  /**
   * @param {string} [type] Type of geometry data
   * @param {string} [srid] SRID of type
   */
  constructor(type: GeometryType, srid?: number);
  constructor(options: GeometryOptions);
  constructor(typeOrOptions: GeometryType | GeometryOptions, srid?: number) {
    super();

    this.options = isObject(typeOrOptions)
      ? { ...typeOrOptions }
      : { type: typeOrOptions, srid };
  }

  stringify(value: string | Buffer, options: StringifyOptions) {
    return `STGeomFromText(${options.escape(
      wkx.Geometry.parseGeoJSON(value).toWkt(),
    )})`;
  }

  bindParam(
    value: string | Buffer | wkx.Geometry,
    options: BindParamOptions,
  ) {
    return `STGeomFromText(${options.bindParam(
      wkx.Geometry.parseGeoJSON(value).toWkt(),
    )})`;
  }
}

/**
 * A geography datatype represents two dimensional spacial objects in an elliptic coord system.
 *
 * **The difference from geometry and geography type:**
 *
 * PostGIS 1.5 introduced a new spatial type called geography, which uses geodetic measurement instead of Cartesian measurement.
 * Coordinate points in the geography type are always represented in WGS 84 lon lat degrees (SRID 4326),
 * but measurement functions and relationships STDistance, STDWithin, STLength, and STArea always return answers in meters or assume inputs in meters.
 *
 * **What is best to use? It depends:**
 *
 * When choosing between the geometry and geography type for data storage, you should consider what you’ll be using it for.
 * If all you do are simple measurements and relationship checks on your data, and your data covers a fairly large area, then most likely you’ll be better off storing your data using the new geography type.
 * Although the new geography data type can cover the globe, the geometry type is far from obsolete.
 * The geometry type has a much richer set of functions than geography, relationship checks are generally faster, and it has wider support currently across desktop and web-mapping tools
 *
 * @example <caption>Defining a Geography type attribute</caption>
 * DataTypes.GEOGRAPHY
 * DataTypes.GEOGRAPHY('POINT')
 * DataTypes.GEOGRAPHY('POINT', 4326)
 */
@classToInvokable
class GEOGRAPHY extends GEOMETRY {
  readonly key = 'GEOGRAPHY';
}

/**
 * The cidr type holds an IPv4 or IPv6 network specification. Takes 7 or 19 bytes.
 *
 * Only available for Postgres
 */
@classToInvokable
class CIDR extends AbstractDataType<string> {
  readonly key = 'CIDR';

  public validate(value: any) {
    if (typeof value !== 'string' || !Validator.isIPRange(value)) {
      throw new ValidationError(
        util.format('%j is not a valid CIDR', value),
        [],
      );
    }

    return true;
  }
}

/**
 * The INET type holds an IPv4 or IPv6 host address, and optionally its subnet. Takes 7 or 19 bytes
 *
 * Only available for Postgres
 */
@classToInvokable
class INET extends AbstractDataType<string> {
  readonly key = 'INET';
  public validate(value: any) {
    if (typeof value !== 'string' || !Validator.isIP(value)) {
      throw new ValidationError(
        util.format('%j is not a valid INET', value),
        [],
      );
    }

    return true;
  }
}

/**
 * The MACADDR type stores MAC addresses. Takes 6 bytes
 *
 * Only available for Postgres
 */
@classToInvokable
class MACADDR extends AbstractDataType<string> {
  readonly key = 'MACADDR';

  public validate(value: any) {
    if (typeof value !== 'string' || !Validator.isMACAddress(value)) {
      throw new ValidationError(
        util.format('%j is not a valid MACADDR', value),
        [],
      );
    }

    return true;
  }
}

/**
 * The TSVECTOR type stores text search vectors.
 *
 * Only available for Postgres
 */
@classToInvokable
class TSVECTOR extends AbstractDataType<string> {
  readonly key = 'TSVECTOR';

  public validate(value: any) {
    if (typeof value !== 'string') {
      throw new ValidationError(
        util.format('%j is not a valid string', value),
        [],
      );
    }

    return true;
  }
}

/**
 * A convenience class holding commonly used data types. The data types are used when defining a new model using `Sequelize.define`, like this:
 * ```js
 * sequelize.define('model', {
 *   column: DataTypes.INTEGER
 * })
 * ```
 * When defining a model you can just as easily pass a string as type, but often using the types defined here is beneficial. For example, using `DataTypes.BLOB`, mean
 * that that column will be returned as an instance of `Buffer` when being fetched by sequelize.
 *
 * To provide a length for the data type, you can invoke it like a function: `INTEGER(2)`
 *
 * Some data types have special properties that can be accessed in order to change the data type.
 * For example, to get an unsigned integer with zerofill you can do `DataTypes.INTEGER.UNSIGNED.ZEROFILL`.
 * The order you access the properties in do not matter, so `DataTypes.INTEGER.ZEROFILL.UNSIGNED` is fine as well.
 *
 * * All number types (`INTEGER`, `BIGINT`, `FLOAT`, `DOUBLE`, `REAL`, `DECIMAL`) expose the properties `UNSIGNED` and `ZEROFILL`
 * * The `CHAR` and `STRING` types expose the `BINARY` property
 *
 * Three of the values provided here (`NOW`, `UUIDV1` and `UUIDV4`) are special default values, that should not be used to define types. Instead they are used as shorthands for
 * defining default values. For example, to get a uuid field with a default value generated following v1 of the UUID standard:
 * ```js
 * sequelize.define('model', {
 *   uuid: {
 *     type: DataTypes.UUID,
 *     defaultValue: DataTypes.UUIDV1,
 *     primaryKey: true
 *   }
 * })
 * ```
 * There may be times when you want to generate your own UUID conforming to some other algorithm. This is accomplished
 * using the defaultValue property as well, but instead of specifying one of the supplied UUID types, you return a value
 * from a function.
 * ```js
 * sequelize.define('model', {
 *   uuid: {
 *     type: DataTypes.UUID,
 *     defaultValue: function() {
 *       return generateMyId()
 *     },
 *     primaryKey: true
 *   }
 * })
 * ```
 */
export const DataTypes = {
  AbstractDataType,
  STRING,
  CHAR,
  TEXT,
  TINYINT,
  SMALLINT,
  MEDIUMINT,
  INTEGER,
  BIGINT,
  FLOAT,
  TIME,
  DATE,
  DATEONLY,
  BOOLEAN,
  NOW,
  BLOB,
  DECIMAL,
  UUID,
  UUIDV1,
  UUIDV4,
  HSTORE,
  JSONB,
  VIRTUAL,
  ARRAY,
  ENUM,
  RANGE,
  REAL,
  DOUBLE,
  GEOMETRY,
  GEOGRAPHY,
  CIDR,
  INET,
  MACADDR,
  CITEXT,
  TSVECTOR,
};
