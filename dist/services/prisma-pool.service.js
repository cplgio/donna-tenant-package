"use strict";
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __setFunctionName = (this && this.__setFunctionName) || function (f, name, prefix) {
    if (typeof name === "symbol") name = name.description ? "[".concat(name.description, "]") : "";
    return Object.defineProperty(f, "name", { configurable: true, value: prefix ? "".concat(prefix, " ", name) : name });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrismaPoolService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const env_util_1 = require("../utils/env.util");
let PrismaPoolService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var PrismaPoolService = _classThis = class {
        constructor() {
            this.logger = new common_1.Logger(PrismaPoolService.name);
            this.pool = new Map();
        }
        // Services
        async getClient(key, url) {
            await this.cleanupExpired();
            const now = Date.now();
            const existing = this.pool.get(key);
            if (existing && existing.expiresAt > now) {
                existing.lastUsed = now;
                return existing.prisma;
            }
            if (existing) {
                try {
                    await existing.prisma.$disconnect();
                }
                catch (err) {
                    this.logger.warn(`Failed to disconnect stale Prisma client for ${key}`, err);
                }
                this.pool.delete(key);
            }
            try {
                const ttlMs = (0, env_util_1.getPrismaCacheTtlMs)();
                const cacheLimit = (0, env_util_1.getPrismaCacheMax)();
                const prisma = new client_1.PrismaClient({ datasources: { db: { url } } });
                const entry = {
                    prisma,
                    expiresAt: now + ttlMs,
                    lastUsed: now,
                };
                this.pool.set(key, entry);
                await this.enforceLimit(cacheLimit);
                return prisma;
            }
            catch (err) {
                this.logger.error(`Failed to create Prisma client for ${key}`, err);
                throw err;
            }
        }
        // Utils
        async cleanupExpired() {
            const now = Date.now();
            for (const [key, entry] of this.pool.entries()) {
                if (entry.expiresAt <= now) {
                    try {
                        await entry.prisma.$disconnect();
                    }
                    catch (err) {
                        this.logger.warn(`Failed to disconnect expired Prisma client for ${key}`, err);
                    }
                    this.pool.delete(key);
                }
            }
        }
        async enforceLimit(cacheLimit) {
            if (this.pool.size <= cacheLimit)
                return;
            let lruKey = null;
            let lruTime = Infinity;
            for (const [key, entry] of this.pool.entries()) {
                if (entry.lastUsed < lruTime) {
                    lruKey = key;
                    lruTime = entry.lastUsed;
                }
            }
            if (lruKey) {
                const entry = this.pool.get(lruKey);
                if (entry) {
                    try {
                        await entry.prisma.$disconnect();
                    }
                    catch (err) {
                        this.logger.warn(`Failed to disconnect LRU Prisma client for ${lruKey}`, err);
                    }
                }
                this.pool.delete(lruKey);
            }
        }
    };
    __setFunctionName(_classThis, "PrismaPoolService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        PrismaPoolService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return PrismaPoolService = _classThis;
})();
exports.PrismaPoolService = PrismaPoolService;
