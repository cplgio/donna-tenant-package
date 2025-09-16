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
exports.TenantService = void 0;
const common_1 = require("@nestjs/common");
let TenantService = (() => {
    let _classDecorators = [(0, common_1.Injectable)()];
    let _classDescriptor;
    let _classExtraInitializers = [];
    let _classThis;
    var TenantService = _classThis = class {
        constructor(firestore, cache, prismaPool) {
            this.firestore = firestore;
            this.cache = cache;
            this.prismaPool = prismaPool;
            this.logger = new common_1.Logger(TenantService.name);
        }
        // Services
        async getTenantById(tenantId) {
            try {
                const cached = await this.cache.getTenant(tenantId);
                if (cached)
                    return cached;
                const doc = await this.firestore.collection('tenants').doc(tenantId).get();
                if (!doc.exists) {
                    throw new Error(`Tenant ${tenantId} not found`);
                }
                const tenant = { id: doc.id, ...doc.data() };
                await this.cache.setTenant(tenant);
                return tenant;
            }
            catch (err) {
                this.logger.error(`Failed to get tenant by id ${tenantId}`, err);
                throw err;
            }
        }
        async getTenantByWorkspaceId(workspaceTenantId) {
            try {
                const cachedId = await this.cache.getTenantIdByWorkspace(workspaceTenantId);
                if (cachedId)
                    return await this.getTenantById(cachedId);
                const snap = await this.firestore
                    .collection('tenants')
                    .where('microsoft.GRAPH_TENANT_ID', '==', workspaceTenantId)
                    .limit(1)
                    .get();
                if (snap.empty) {
                    throw new Error(`Tenant workspace ${workspaceTenantId} not found`);
                }
                const doc = snap.docs[0];
                const tenant = { id: doc.id, ...doc.data() };
                await this.cache.setTenant(tenant);
                return tenant;
            }
            catch (err) {
                this.logger.error(`Failed to get tenant by workspace id ${workspaceTenantId}`, err);
                throw err;
            }
        }
        async getPrismaFor(input) {
            try {
                if (input.tenantId) {
                    const tenant = await this.getTenantById(input.tenantId);
                    return await this.getPrismaForTenant(tenant);
                }
                if (input.userId) {
                    const snap = await this.firestore
                        .collection('user_tenants')
                        .where('userId', '==', input.userId)
                        .where('active', '==', true)
                        .limit(1)
                        .get();
                    const tenantId = snap.docs[0]?.data()?.tenantId;
                    if (!tenantId)
                        throw new Error(`Tenant for user ${input.userId} not found`);
                    const tenant = await this.getTenantById(tenantId);
                    return await this.getPrismaForTenant(tenant);
                }
                throw new Error('tenantId or userId required');
            }
            catch (err) {
                this.logger.error('Failed to resolve Prisma client', err);
                throw err;
            }
        }
        async getPrismaByWorkspaceTenantId(workspaceTenantId) {
            try {
                const tenant = await this.getTenantByWorkspaceId(workspaceTenantId);
                const prisma = await this.getPrismaForTenant(tenant);
                return { prisma, tenant };
            }
            catch (err) {
                this.logger.error(`Failed to get Prisma by workspace tenant id ${workspaceTenantId}`, err);
                throw err;
            }
        }
        // Utils
        async getPrismaForTenant(tenant) {
            return this.prismaPool.getClient(tenant.id, tenant.db);
        }
    };
    __setFunctionName(_classThis, "TenantService");
    (() => {
        const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(null) : void 0;
        __esDecorate(null, _classDescriptor = { value: _classThis }, _classDecorators, { kind: "class", name: _classThis.name, metadata: _metadata }, null, _classExtraInitializers);
        TenantService = _classThis = _classDescriptor.value;
        if (_metadata) Object.defineProperty(_classThis, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        __runInitializers(_classThis, _classExtraInitializers);
    })();
    return TenantService = _classThis;
})();
exports.TenantService = TenantService;
