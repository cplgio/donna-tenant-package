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
exports.TenantCacheService = void 0;
const common_1 = require("@nestjs/common");
const env_util_1 = require("../utils/env.util");
// Utils
const tenantKey = (tenantId) => `tenants:${tenantId}`;
const workspaceKey = (workspaceTenantId) => `tenants:byWorkspace:${workspaceTenantId}`;
let TenantCacheService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var TenantCacheService = _classThis = class {
        constructor(redis) {
            this.redis = redis;
            this.logger = new common_1.Logger(TenantCacheService.name);
            // memory caches
            this.tenantMemory = new Map();
            this.workspaceMemory = new Map();
        }
        // Services
        async getTenant(tenantId) {
            const cached = this.tenantMemory.get(tenantId);
            if (cached) {
                return cached;
            }
            if (!this.redis)
                return null;
            try {
                const data = await this.redis.get(tenantKey(tenantId));
                if (!data)
                    return null;
                const parsed = JSON.parse(data);
                this.tenantMemory.set(tenantId, parsed);
                return parsed;
            }
            catch (err) {
                this.logger.warn(`Redis getTenant failed: ${err}`);
                return null;
            }
        }
        async setTenant(tenant, ttlSeconds = (0, env_util_1.getTenantCacheTtlSeconds)()) {
            this.tenantMemory.set(tenant.id, tenant);
            if (tenant.microsoft?.GRAPH_TENANT_ID) {
                this.workspaceMemory.set(tenant.microsoft.GRAPH_TENANT_ID, tenant.id);
            }
            if (!this.redis)
                return;
            const payload = JSON.stringify(tenant);
            try {
                await this.redis.set(tenantKey(tenant.id), payload, 'EX', ttlSeconds);
                if (tenant.microsoft?.GRAPH_TENANT_ID) {
                    await this.redis.set(workspaceKey(tenant.microsoft.GRAPH_TENANT_ID), tenant.id, 'EX', ttlSeconds);
                }
            }
            catch (err) {
                this.logger.warn(`Redis setTenant failed: ${err}`);
            }
        }
        async getTenantIdByWorkspace(workspaceTenantId) {
            const cached = this.workspaceMemory.get(workspaceTenantId);
            if (cached)
                return cached;
            if (!this.redis)
                return null;
            try {
                const data = await this.redis.get(workspaceKey(workspaceTenantId));
                if (!data)
                    return null;
                this.workspaceMemory.set(workspaceTenantId, data);
                return data;
            }
            catch (err) {
                this.logger.warn(`Redis getTenantIdByWorkspace failed: ${err}`);
                return null;
            }
        }
        async invalidateTenant(tenantId, workspaceTenantId) {
            this.tenantMemory.delete(tenantId);
            if (workspaceTenantId) {
                this.workspaceMemory.delete(workspaceTenantId);
            }
            if (!this.redis)
                return;
            try {
                await this.redis.del(tenantKey(tenantId));
                if (workspaceTenantId) {
                    await this.redis.del(workspaceKey(workspaceTenantId));
                }
            }
            catch (err) {
                this.logger.warn(`Redis invalidateTenant failed: ${err}`);
            }
        }
    };
    __setFunctionName(_classThis, "TenantCacheService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        TenantCacheService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return TenantCacheService = _classThis;
})();
exports.TenantCacheService = TenantCacheService;
