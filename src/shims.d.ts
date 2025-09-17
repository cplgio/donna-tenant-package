declare module '@nestjs/common' {
  export type Provider = Record<string, unknown>;
  export function Injectable(): ClassDecorator;
  export function Global(): ClassDecorator;
  export function Module(metadata: {
    providers?: unknown[];
    exports?: unknown[];
    imports?: unknown[];
  }): ClassDecorator;
  export function Inject(token: string | symbol | Record<string, unknown>): ParameterDecorator;
  export class Logger {
    constructor(context: string);
    log(message: string, ...optionalParams: unknown[]): void;
    warn(message: string, ...optionalParams: unknown[]): void;
    error(message: string, ...optionalParams: unknown[]): void;
  }
}

declare module '@prisma/client' {
  export interface DatasourceConfig {
    url?: string;
  }
  export interface DatasourceOptions {
    db?: DatasourceConfig;
  }
  export interface PrismaClientOptions {
    datasources?: DatasourceOptions;
  }
  export class PrismaClient {
    constructor(options?: PrismaClientOptions);
    $disconnect(): Promise<void>;
  }
}

declare module 'firebase-admin/firestore' {
  export function getFirestore(): Firestore;

  export interface FirestoreQuerySnapshot {
    empty: boolean;
    docs: Array<{
      id: string;
      data(): any;
    }>;
  }

  export interface FirestoreDocumentSnapshot {
    id: string;
    exists: boolean;
    data(): any;
  }

  export interface FirestoreCollectionReference {
    doc(id: string): { get(): Promise<FirestoreDocumentSnapshot> };
    where(fieldPath: string, opStr: FirebaseFirestore.WhereFilterOp, value: unknown): FirestoreQuery;
    limit(count: number): FirestoreQuery;
    get(): Promise<FirestoreQuerySnapshot>;
  }

  export interface FirestoreQuery {
    where(fieldPath: string, opStr: FirebaseFirestore.WhereFilterOp, value: unknown): FirestoreQuery;
    limit(count: number): FirestoreQuery;
    get(): Promise<FirestoreQuerySnapshot>;
  }

  export class Firestore {
    collection(collectionPath: string): FirestoreCollectionReference;
  }
}

declare module 'firebase-admin/app' {
  export interface CredentialCertificate {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  }

  export function cert(certificate: CredentialCertificate): unknown;
  export function initializeApp(options: { credential: unknown }): void;
  export function getApps(): unknown[];
}

declare namespace FirebaseFirestore {
  type WhereFilterOp =
    | '<'
    | '<='
    | '=='
    | '!='
    | '>='
    | '>'
    | 'array-contains'
    | 'in'
    | 'array-contains-any'
    | 'not-in';
}

declare module 'ioredis' {
  export interface RedisOptions {
    lazyConnect?: boolean;
    [key: string]: unknown;
  }

  export default class Redis {
    constructor(connectionString: string, options?: RedisOptions);
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode?: string, duration?: number): Promise<'OK' | null>;
    del(...keys: string[]): Promise<number>;
  }
}

// Node Globals
declare namespace NodeJS {
  interface ProcessEnv {
    TENANT_PRISMA_CACHE_TTL_MS?: string;
    TENANT_PRISMA_CACHE_MAX?: string;
    TENANT_CACHE_TTL_SECONDS?: string;
    FIREBASE_PROJECT_ID?: string;
    FIREBASE_CLIENT_EMAIL?: string;
    FIREBASE_PRIVATE_KEY?: string;
    REDIS_URL?: string;
    [key: string]: string | undefined;
  }
}

declare const process: {
  env: NodeJS.ProcessEnv;
};
