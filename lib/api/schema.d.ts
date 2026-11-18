/**
 * GENERATED FILE: do not edit by hand.
 * Source: the API's OpenAPI 3.1 document (api/scripts/dump-openapi.ts) through openapi-typescript.
 * Regenerate with `npm run api:types`; CI fails (`npm run api:types:check`) when this file is stale.
 */

export interface paths {
    "/v1/auth/providers": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Which social sign-in providers are configured (both client id and secret set). Public: the sign-in page needs it before anyone is signed in; it carries no id and no secret */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            google: boolean;
                            microsoft: boolean;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/sessions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The caller's active sessions, newest activity first. No token, no IP address */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string;
                                /** @description Browser and operating system, for example Chrome on macOS */
                                label: string;
                                /** Format: date-time */
                                createdAt: string;
                                /** Format: date-time */
                                lastSeenAt: string;
                                /** @description True for the session making this request */
                                current: boolean;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/sessions/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Signed that session out. Another user's or a never-existing id is 404 session_not_found; the current session is 409 current_session (use sign-out) */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The caller and their active tenants */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /**
                             * @example {
                             *       "id": "usr_8Kq2mZ4tW1",
                             *       "email": "alex@example.ie",
                             *       "name": "Alex Byrne",
                             *       "emailVerified": true,
                             *       "twoFactorEnabled": false
                             *     }
                             */
                            user: {
                                id: string;
                                email: string;
                                name: string;
                                emailVerified: boolean;
                                twoFactorEnabled: boolean;
                            };
                            /**
                             * @description The caller's ACTIVE platform staff role; null for everyone else
                             * @enum {string|null}
                             */
                            platformRole: "owner" | "support" | "billing" | "viewer" | null;
                            tenants: {
                                slug: string;
                                name: string;
                                roleKey: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tenants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        slug: string;
                        timezone?: string;
                        currency?: string;
                        locale?: string;
                    };
                };
            };
            responses: {
                /** @description Tenant created; the caller is its owner. The caller's first tenant needs no second factor; later ones need an MFA-verified session (401 mfa_enrolment_required / mfa_challenge). 403 tenant_limit_reached over TENANT_CREATE_MAX_PER_USER */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            slug: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/tenant": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Tenant and member context of the caller, with the brand, the report deadline, this request's device and Drive availability (staff cannot read settings, so the shell reads them here) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            tenant: {
                                id: string;
                                slug: string;
                                name: string;
                                timezone: string;
                                currency: string;
                                locale: string;
                                sessionIdleHours: number;
                                /**
                                 * @example {
                                 *       "mode": "off",
                                 *       "roles": []
                                 *     }
                                 */
                                mfaPolicy: {
                                    /** @enum {string} */
                                    mode: "off" | "all" | "roles";
                                    roles: string[];
                                };
                            };
                            member: {
                                userId: string;
                                roleId: string;
                                roleKey: string;
                                role: {
                                    label: string;
                                    description: string;
                                    /** @enum {string} */
                                    home: "manager" | "staff";
                                    /** @description The caller's OWN role, module -> none|read|write (staff cannot read GET /v1/roles, so the shell gets it here) */
                                    access: {
                                        [key: string]: "none" | "read" | "write";
                                    };
                                };
                            };
                            brand: {
                                primaryColor: string | null;
                            };
                            /** @description HH:mm, tenant-local */
                            reportDeadline: string;
                            reportDueAfterMinutes: number;
                            device: {
                                /** @description null for the unregistered browser */
                                id: string | null;
                                type: string;
                                label: string;
                                trusted: boolean;
                            };
                            features: {
                                /** @description Evaluated for THIS request's device and the tenant's Drive policy */
                                drive: boolean;
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Pending (not yet accepted) invites of the tenant, newest first, at most 200. Expired ones are listed so they can be re-sent. No token or token hash. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                email: string;
                                roleKey: string;
                                createdAt: string;
                                expiresAt: string;
                                invitedBy: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        email: string;
                        /** Format: uuid */
                        roleId: string;
                    };
                };
            };
            responses: {
                /** @description Invite created and emailed */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            email: string;
                            expiresAt: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invites/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Revoked (audited invite.revoked); the link stops working at once. 404 invite_not_found, 409 invite_used (already accepted). Open to a read-only (blocked) tenant. */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invites/{id}/resend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description A new token replaces the old one (the old link stops working), the expiry restarts and ONE mail is sent. The caller becomes the inviter of record and must be allowed to hand out the invited role (R24: 403 role_escalation). 404 invite_not_found, 409 invite_used, 422 role_not_invitable, 429 resend_too_soon (within 60 s of the last send). */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            email: string;
                            expiresAt: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/invites/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        token: string;
                    };
                };
            };
            responses: {
                /** @description Joined the tenant. Re-validates the inviter's CURRENT standing: a demoted, suspended or removed inviter, or an invited role above the inviter's current access, is 410 invite_invalid (nothing is written). 404 invite_not_found, 403 invite_email_mismatch, 409 invite_used | already_member | seat_limit, 410 invite_expired. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            slug: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/roles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Roles of the tenant */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            key: string;
                            label: string;
                            description: string;
                            home: string;
                            access: {
                                [key: string]: "none" | "read" | "write";
                            };
                            fieldRules: {
                                [key: string]: string[];
                            };
                            /** @enum {string|null} */
                            rosterLevel: "office" | "supervisor" | null;
                            isTemplate: boolean;
                            clonedFrom: string | null;
                        }[];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/roles/{id}/clone": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        label: string;
                    };
                };
            };
            responses: {
                /** @description Editable copy of the role (access, field rules and roster level are copied; 403 role_escalation when the source has a roster level above the caller's own) */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            key: string;
                            label: string;
                            description: string;
                            home: string;
                            access: {
                                [key: string]: "none" | "read" | "write";
                            };
                            fieldRules: {
                                [key: string]: string[];
                            };
                            /** @enum {string|null} */
                            rosterLevel: "office" | "supervisor" | null;
                            isTemplate: boolean;
                            clonedFrom: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/roles/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        label?: string;
                        access?: {
                            /** @enum {string} */
                            dashboard?: "none" | "read" | "write";
                            /** @enum {string} */
                            tasks?: "none" | "read" | "write";
                            /** @enum {string} */
                            reports?: "none" | "read" | "write";
                            /** @enum {string} */
                            attention?: "none" | "read" | "write";
                            /** @enum {string} */
                            staff?: "none" | "read" | "write";
                            /** @enum {string} */
                            shifts?: "none" | "read" | "write";
                            /** @enum {string} */
                            recruitment?: "none" | "read" | "write";
                            /** @enum {string} */
                            files?: "none" | "read" | "write";
                            /** @enum {string} */
                            payroll?: "none" | "read" | "write";
                            /** @enum {string} */
                            orders?: "none" | "read" | "write";
                            /** @enum {string} */
                            settings?: "none" | "read" | "write";
                            /** @enum {string} */
                            audit?: "none" | "read" | "write";
                            /** @enum {string} */
                            roster?: "none" | "read" | "write";
                        };
                        fieldRules?: {
                            [key: string]: string[];
                        };
                        /** @enum {string|null} */
                        rosterLevel?: "office" | "supervisor" | null;
                    };
                };
            };
            responses: {
                /** @description Updated role. `rosterLevel` (office | supervisor | null) is the roster level of the role; a caller cannot grant a level above their own, nor re-level a role that outranks them (403 role_escalation) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            key: string;
                            label: string;
                            description: string;
                            home: string;
                            access: {
                                [key: string]: "none" | "read" | "write";
                            };
                            fieldRules: {
                                [key: string]: string[];
                            };
                            /** @enum {string|null} */
                            rosterLevel: "office" | "supervisor" | null;
                            isTemplate: boolean;
                            clonedFrom: string | null;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    userId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        roleId: string;
                    };
                };
            };
            responses: {
                /** @description Member with the new role */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            userId: string;
                            roleId: string;
                            roleKey: string;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/teams": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    member?: string;
                    kind?: "team" | "department";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Teams and departments of the tenant, optionally those a member belongs to */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            /** @enum {string} */
                            kind: "team" | "department";
                            memberIds: string[];
                        }[];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        /**
                         * @default team
                         * @enum {string}
                         */
                        kind?: "team" | "department";
                    };
                };
            };
            responses: {
                /** @description Created team */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            /** @enum {string} */
                            kind: "team" | "department";
                            memberIds: string[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/teams/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name?: string;
                        /** @enum {string} */
                        kind?: "team" | "department";
                    };
                };
            };
            responses: {
                /** @description Updated team */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            /** @enum {string} */
                            kind: "team" | "department";
                            memberIds: string[];
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/teams/{id}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        userIds: string[];
                    };
                };
            };
            responses: {
                /** @description Team with its new member set */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            /** @enum {string} */
                            kind: "team" | "department";
                            memberIds: string[];
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/members/{userId}/manager": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    userId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        managerId: string | null;
                    };
                };
            };
            responses: {
                /** @description The member's primary manager (null = none) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            userId: string;
                            managerId: string | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/people": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    scope?: "own" | "team" | "all";
                    /** @description Default active. deactivated and all need settings:read (Settings -> Users); anyone else gets 403 forbidden */
                    status?: "active" | "deactivated" | "all";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description People in the caller's report scope with their status (active | deactivated) and lastActiveAt (the last authenticated request, stamped at most every 5 minutes; null = never seen) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            userId: string;
                            name: string;
                            email: string;
                            roleKey: string;
                            managerId: string | null;
                            /** @enum {string} */
                            status: "active" | "deactivated";
                            lastActiveAt: string | null;
                        }[];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Archived tasks in the caller's scope, newest archive first, with the days left to restore; pass nextCursor back as cursor. Managers only. 400 invalid_cursor; 403 forbidden */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                ref: string;
                                version: number;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                                priority: number;
                                dept: string;
                                teamId: string | null;
                                assignee: string;
                                assignees: string[];
                                creator: string;
                                start: string;
                                due: string;
                                startAt: string;
                                dueAt: string;
                                tags: string[];
                                projectId?: string;
                                parentId: string | null;
                                archivedAt: string;
                                archivedAtUtc: string;
                                archivedBy: string | null;
                                daysLeft: number;
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/board": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    due?: "all" | "today" | "overdue" | "week";
                    priority?: "1" | "2" | "3";
                    assignee?: string;
                    project?: "none" | string;
                    repeat?: "recurring";
                    q?: string;
                    ref?: string;
                    label?: string;
                    evidence?: "verified" | "awaiting" | "rejected" | "missing";
                    /** @description Tasks filed under this department or assigned to one of its members, inside the caller's scope; a team the caller cannot reach or that does not exist is an empty list */
                    teamId?: string;
                    /** @description Page ONE column: with `cursor` (that column's nextCursor) */
                    column?: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                    cursor?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description One column per status (STATUS_ORDER) with its count and up to 50 cards, soonest due first; page one column with column + cursor. 400 invalid_cursor */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            columns: {
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                                count: number;
                                items: {
                                    /** Format: uuid */
                                    id: string;
                                    ref: string;
                                    version: number;
                                    title: string;
                                    /** @enum {string} */
                                    status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                                    priority: number;
                                    dept: string;
                                    teamId: string | null;
                                    assignee: string;
                                    assignees: string[];
                                    creator: string;
                                    start: string;
                                    due: string;
                                    startAt: string;
                                    dueAt: string;
                                    tags: string[];
                                    projectId?: string;
                                    parentId: string | null;
                                }[];
                                nextCursor: string | null;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/calendar": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    /** @description First tenant-local day, YYYY-MM-DD */
                    from?: string;
                    /** @description Last tenant-local day, inclusive; at most 42 days from `from` */
                    to?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Cards grouped by the tenant-local due date, every day of the range present (at most 42 days, 1000 cards). 422 invalid_range */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            days: {
                                date: string;
                                tasks: {
                                    /** Format: uuid */
                                    id: string;
                                    ref: string;
                                    version: number;
                                    title: string;
                                    /** @enum {string} */
                                    status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                                    priority: number;
                                    dept: string;
                                    teamId: string | null;
                                    assignee: string;
                                    assignees: string[];
                                    creator: string;
                                    start: string;
                                    due: string;
                                    startAt: string;
                                    dueAt: string;
                                    tags: string[];
                                    projectId?: string;
                                    parentId: string | null;
                                }[];
                            }[];
                            truncated: boolean;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    cursor?: string;
                    status?: "all" | "open" | "review" | "stuck" | "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                    due?: "all" | "today" | "overdue" | "week";
                    priority?: "1" | "2" | "3";
                    assignee?: string;
                    project?: "none" | string;
                    repeat?: "recurring";
                    q?: string;
                    ref?: string;
                    label?: string;
                    evidence?: "verified" | "awaiting" | "rejected" | "missing";
                    /** @description Tasks filed under this department or assigned to one of its members, inside the caller's scope; a team the caller cannot reach or that does not exist is an empty list */
                    teamId?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Tasks in the caller's scope, soonest due first; pass nextCursor back as cursor. 400 invalid_cursor */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                ref: string;
                                version: number;
                                title: string;
                                description: string;
                                dept: string;
                                teamId: string | null;
                                assignee: string;
                                assignees: string[];
                                creator: string;
                                priority: number;
                                start: string;
                                due: string;
                                startAt: string;
                                dueAt: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                                /**
                                 * @example {
                                 *       "mode": "none",
                                 *       "types": [],
                                 *       "min": 0,
                                 *       "instruction": "",
                                 *       "review": "manager"
                                 *     }
                                 */
                                evidenceRule: {
                                    /** @enum {string} */
                                    mode: "none" | "optional" | "required";
                                    types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                    min: number;
                                    instruction: string;
                                    /** @enum {string} */
                                    review: "auto" | "creator" | "manager" | "named";
                                    reviewer?: string;
                                };
                                client?: string;
                                tags: string[];
                                estimate?: number;
                                projectId?: string;
                                milestoneId?: string;
                                parentRef?: string;
                                parentId: string | null;
                                checklist: {
                                    id: string;
                                    text: string;
                                    done: boolean;
                                }[];
                                subtasks: {
                                    id: string;
                                    ref: string;
                                    title: string;
                                    /** @enum {string} */
                                    status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                                }[];
                                dependsOn: string[];
                                dependsOnIds: string[];
                                dependencies: {
                                    id: string;
                                    ref: string;
                                    title: string;
                                    /** @enum {string} */
                                    status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                                }[];
                                hiddenDependencies: number;
                                blocks: {
                                    id: string;
                                    ref: string;
                                    title: string;
                                    /** @enum {string} */
                                    status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                                }[];
                                hiddenBlocks: number;
                                archivedAt?: string;
                                archivedBy?: string;
                                /**
                                 * @example {
                                 *       "start": "2026-11-21T09:00:00",
                                 *       "due": "2026-11-21T17:00:00",
                                 *       "reason": "Waiting on keys",
                                 *       "by": "Ann Byrne",
                                 *       "at": "2026-11-20T17:00:00"
                                 *     }
                                 */
                                proposal?: {
                                    start: string;
                                    due: string;
                                    reason: string;
                                    by: string;
                                    at: string;
                                };
                                round: number;
                                /**
                                 * @example {
                                 *       "freq": "weekly",
                                 *       "days": [
                                 *         1,
                                 *         3
                                 *       ],
                                 *       "until": "2026-12-31"
                                 *     }
                                 */
                                repeat?: {
                                    /** @enum {string} */
                                    freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                    patternId?: string;
                                    days?: number[];
                                    dayOfMonth?: number;
                                    until?: string;
                                };
                                seriesId?: string;
                                submittedAt?: string;
                                completedAt?: string;
                                notes: {
                                    at: string;
                                    by: string;
                                    text: string;
                                    changes?: {
                                        field: string;
                                        from: string;
                                        to: string;
                                    }[];
                                    notified?: string[];
                                    updateId?: string;
                                }[];
                                evidence: {
                                    id: string;
                                    kind: string;
                                    name: string;
                                    by: string;
                                    at: string;
                                    /** @enum {string} */
                                    review: "pending" | "accepted" | "rejected";
                                    reason?: string;
                                    round: number;
                                    locked: boolean;
                                    source?: string;
                                    capturedAt?: string;
                                    url?: string;
                                    size?: number;
                                    fileId?: string;
                                    /** @enum {string} */
                                    fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                    reviewedBy?: string;
                                    reviewedAt?: string;
                                }[];
                                timeline: {
                                    id: string;
                                    at: string;
                                    atUtc: string;
                                    actorId: string | null;
                                    by: string;
                                    kind: string;
                                    text: string;
                                    changes: {
                                        field: string;
                                        from: string;
                                        to: string;
                                    }[];
                                    notified: string[];
                                    hiddenNotified: number;
                                    hiddenDependencies: number;
                                    updateId?: string;
                                }[];
                                overdue?: {
                                    reason: string;
                                    nextAction: string;
                                    owner: string;
                                    revisedDue: string;
                                };
                                timeEntries: {
                                    id: string;
                                    at: string;
                                    by: string;
                                    minutes: number;
                                    note: string;
                                    source: string;
                                }[];
                                evidenceState: string | null;
                                /**
                                 * @example {
                                 *       "durationSec": 12,
                                 *       "mime": "audio/webm",
                                 *       "recordedBy": "usr_8Kq2mZ4tW1",
                                 *       "recordedAt": "2026-11-20T17:00:00.000Z"
                                 *     }
                                 */
                                voiceNote: {
                                    durationSec: number;
                                    mime: string;
                                    recordedBy: string;
                                    recordedAt: string;
                                } | null;
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        title: string;
                        /** @default  */
                        description?: string;
                        /** @default 2 */
                        priority?: number;
                        /**
                         * @description Tenant-local wall clock YYYY-MM-DDTHH:mm[:ss] (ruling D3)
                         * @example 2026-11-20T17:00:00
                         */
                        start: string;
                        /**
                         * @description Tenant-local wall clock YYYY-MM-DDTHH:mm[:ss] (ruling D3)
                         * @example 2026-11-20T17:00:00
                         */
                        due: string;
                        primary?: string;
                        /** @default [] */
                        others?: string[];
                        /** Format: uuid */
                        teamId?: string | null;
                        /** @default [] */
                        labels?: string[];
                        estimateMin?: number | null;
                        client?: string | null;
                        /**
                         * @example {
                         *       "mode": "none",
                         *       "types": [],
                         *       "min": 0,
                         *       "instruction": "",
                         *       "review": "manager"
                         *     }
                         */
                        evidenceRule?: {
                            /** @enum {string} */
                            mode: "none" | "optional" | "required";
                            types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                            min: number;
                            instruction: string;
                            /** @enum {string} */
                            review: "auto" | "creator" | "manager" | "named";
                            reviewer?: string;
                        };
                        overduePlan?: {
                            reason: string;
                            nextAction: string;
                            owner: string;
                            revisedDue: string;
                        } | null;
                        /**
                         * Format: uuid
                         * @description Only the template's evidence rule is applied here (ruling D23); a body rule wins, then the template's, then the project's default
                         */
                        templateId?: string;
                        /** Format: uuid */
                        projectId?: string | null;
                        /** Format: uuid */
                        milestoneId?: string | null;
                    };
                };
            };
            responses: {
                /** @description The new task. 403 cannot_assign_others; 422 invalid_dates | invalid_assignee | invalid_team | invalid_labels | invalid_evidence_rule | invalid_reviewer */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The task with its last 50 history lines. 404 task_not_found (also when it is outside the caller's scope) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Permanently deleted with its children, dependency edges and files (audited). Tenant admins only, a person (never an API key), and only for an archived task. 403 forbidden | human_required; 404 task_not_found; 409 task_not_archived */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        title?: string;
                        description?: string;
                        priority?: number;
                        labels?: string[];
                        estimateMin?: number | null;
                        client?: string | null;
                        /** Format: uuid */
                        teamId?: string | null;
                        /**
                         * @description Tenant-local wall clock YYYY-MM-DDTHH:mm[:ss] (ruling D3)
                         * @example 2026-11-20T17:00:00
                         */
                        start?: string;
                        /**
                         * @description Tenant-local wall clock YYYY-MM-DDTHH:mm[:ss] (ruling D3)
                         * @example 2026-11-20T17:00:00
                         */
                        due?: string;
                        overduePlan?: {
                            reason: string;
                            nextAction: string;
                            owner: string;
                            revisedDue: string;
                        } | null;
                        /** Format: uuid */
                        projectId?: string | null;
                        /** Format: uuid */
                        milestoneId?: string | null;
                    };
                };
            };
            responses: {
                /** @description The updated task. 403 dates_manager_only | forbidden; 409 version_conflict; 422 invalid_dates | invalid_team | invalid_labels */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/tasks/{id}/assignees": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        primary: string;
                        others: string[];
                    };
                };
            };
            responses: {
                /** @description The task with its new assignees (managers only). 403 forbidden; 409 version_conflict; 422 invalid_assignee */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        /** @enum {string} */
                        to: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                    };
                };
            };
            responses: {
                /** @description The task after the move. 403 forbidden; 409 version_conflict; 422 invalid_transition | evidence_required */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                    };
                };
            };
            responses: {
                /** @description Completed, or Awaiting verification when a reviewer must check. 409 version_conflict; 422 invalid_transition | evidence_required */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/repeat": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        /** @description null stops the repetition */
                        rule: {
                            /**
                             * @description daily | weekdays | weekly | monthly | per_shift (one instance per shift of `patternId` for the primary assignee, start = shift start, due = shift end)
                             * @example weekly
                             */
                            freq: string;
                            /** @description Weekly: weekdays 0 = Sunday … 6 = Saturday */
                            days?: number[];
                            /** @description Monthly: 1–31; a short month uses its last day */
                            dayOfMonth?: number;
                            /** @description per_shift: the shift pattern (a live pattern of this tenant, else 422 invalid_repeat) */
                            patternId?: string;
                            /** @description Last local day (YYYY-MM-DD), inclusive */
                            until?: string;
                        } | null;
                    };
                };
            };
            responses: {
                /** @description The task with its new repetition (managers only); rule null stops it. A job creates the instances. 403 forbidden; 404 task_not_found; 409 version_conflict; 422 invalid_repeat (also for an instance or a subtask, and for per_shift without a live patternId) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/history": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Field history newest first with old and new values in tenant time; pass nextCursor back as cursor. 400 invalid_cursor */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (ruling D4)
                         * @example 1
                         */
                        version: number;
                    };
                };
            };
            responses: {
                /** @description Archived with its open subtasks (one batch); out of every list, board, calendar and search until restored (30 days). Managers only. 403 forbidden; 404 task_not_found; 409 version_conflict | task_archived */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": Record<string, never>;
                };
            };
            responses: {
                /** @description Restored with the rest of its archive batch. Managers only. 403 forbidden; 404 task_not_found; 409 task_not_archived; 410 archive_expired (after 30 days) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/checklist": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        text: string;
                    };
                };
            };
            responses: {
                /** @description The new item (at most 50 per task; the task version does not change). 403 forbidden; 404 task_not_found; 422 checklist_limit */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            text: string;
                            done: boolean;
                            position: number;
                            doneBy: string | null;
                            doneAt: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/checklist/{itemId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    itemId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Removed (creator or manager). 404 task_not_found | checklist_item_not_found */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    itemId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        done?: boolean;
                        text?: string;
                    };
                };
            };
            responses: {
                /** @description The item. `done` is absolute (assignee, manager or creator); `text` is for the creator or a manager. 403 forbidden; 404 task_not_found | checklist_item_not_found */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            text: string;
                            done: boolean;
                            position: number;
                            doneBy: string | null;
                            doneAt: string | null;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/tasks/{id}/subtasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        title: string;
                    };
                };
            };
            responses: {
                /** @description The child task: same team, project and due date, no evidence. Its assignee is the parent's primary when the caller may assign that person (staff: themself; a team manager: themself or a direct report), otherwise the caller. 403 forbidden; 404 task_not_found; 422 subtask_depth */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Comments oldest first; pass nextCursor back as cursor. Drive links are withheld off the company PC. 400 invalid_cursor; 404 task_not_found */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                taskId: string;
                                authorId: string | null;
                                author: string;
                                body: string;
                                mentions: string[];
                                attachmentFileIds: string[];
                                at: string;
                                atUtc: string;
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        body: string;
                        /** @default [] */
                        mentions?: string[];
                        /** @default [] */
                        attachmentFileIds?: string[];
                    };
                };
            };
            responses: {
                /** @description The comment. Mentioned members who can see the task are notified; the answer is the same for everyone else. 404 task_not_found; 422 invalid_attachment */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            taskId: string;
                            authorId: string | null;
                            author: string;
                            body: string;
                            mentions: string[];
                            attachmentFileIds: string[];
                            at: string;
                            atUtc: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/comments/{commentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    commentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Soft-deleted (its author, or a manager of the task). 403 forbidden; 404 task_not_found | comment_not_found */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        purpose: "evidence" | "attachment" | "voice";
                        name: string;
                        mime: string;
                        sizeBytes: number;
                    };
                };
            };
            responses: {
                /** @description A presigned PUT (300 s), same as /v1/files/uploads, but needs M1 and access to the task, not M4 and files:write. 403 forbidden; 404 task_not_found; 422 mime_not_allowed | file_too_large | invalid_name */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            fileId: string;
                            upload: {
                                /** @enum {string} */
                                method: "PUT";
                                url: string;
                                headers: {
                                    [key: string]: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/uploads/{fileId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    fileId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Upload confirmed; the malware scan is queued. Idempotent. 404 task_not_found | file_not_found; 409 upload_missing; 422 upload_mismatch */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            mime: string;
                            sizeBytes: number;
                            /** @enum {string} */
                            status: "pending" | "clean" | "infected" | "deleted";
                            signature: string | null;
                            sha256: string | null;
                            ownerUserId: string | null;
                            createdAt: string;
                            scannedAt: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/files/{fileId}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    fileId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Redirect to a 60 s presigned GET. 404 task_not_found | file_not_found; 409 file_not_ready; 410 file_infected */
                302: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/voice-note": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Redirect to a 60 s presigned GET (Cache-Control: no-store); the play is logged. 404 task_not_found | voice_note_not_found; 409 file_not_ready; 410 file_infected */
                302: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        /**
                         * Format: uuid
                         * @description A `voice` upload of THIS task, already scanned clean
                         * @example 6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8
                         */
                        fileId: string;
                        /**
                         * @description The client's claim, 1 to 120 (the size cap is the server-side bound); more is 422 voice_too_long
                         * @example 42
                         */
                        durationSec: number;
                    };
                };
            };
            responses: {
                /** @description The task with its voice note (the creator or a manager; replaces an earlier note, whose file is deleted unless a recurring instance still uses it; bumps the version). 403 forbidden; 404 task_not_found | file_not_found; 409 version_conflict | task_archived | file_not_ready; 410 file_infected; 422 voice_too_long | file_too_large */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                    };
                };
            };
            responses: {
                /** @description The task without its voice note (the creator or a manager). 403 forbidden; 404 task_not_found | voice_note_not_found; 409 version_conflict | task_archived */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/voice-note/plays": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Who played the note, newest first; pass nextCursor back as cursor. Managers of the task only. 400 invalid_cursor; 403 forbidden; 404 task_not_found */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                userId: string | null;
                                by: string;
                                at: string;
                                atUtc: string;
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/dependencies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        dependsOnIds: string[];
                    };
                };
            };
            responses: {
                /** @description The task with its new finish-to-start dependencies (managers; at most 20). 403 forbidden; 404 task_not_found; 409 version_conflict; 422 dependency_cycle | invalid_dependency */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/reschedule/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description Tenant-local wall clock YYYY-MM-DDTHH:mm[:ss] (ruling D3)
                         * @example 2026-11-20T17:00:00
                         */
                        start: string;
                        /**
                         * @description Tenant-local wall clock YYYY-MM-DDTHH:mm[:ss] (ruling D3)
                         * @example 2026-11-20T17:00:00
                         */
                        due: string;
                    };
                };
            };
            responses: {
                /** @description Every open dependant the new dates would push, down the chain, and a hash of them. Moves outside the caller's scope are flagged outOfScope. 403 forbidden; 404 task_not_found; 422 invalid_dates */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            moves: ({
                                /** Format: uuid */
                                taskId: string;
                                ref: string;
                                title: string;
                                from: {
                                    start: string;
                                    due: string;
                                };
                                to: {
                                    start: string;
                                    due: string;
                                };
                                /** @enum {boolean} */
                                outOfScope: false;
                            } | {
                                /** @enum {boolean} */
                                outOfScope: true;
                            })[];
                            hiddenMoves: number;
                            previewHash: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/reschedule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        /**
                         * @description Tenant-local wall clock YYYY-MM-DDTHH:mm[:ss] (ruling D3)
                         * @example 2026-11-20T17:00:00
                         */
                        start: string;
                        /**
                         * @description Tenant-local wall clock YYYY-MM-DDTHH:mm[:ss] (ruling D3)
                         * @example 2026-11-20T17:00:00
                         */
                        due: string;
                        reason?: string;
                        /**
                         * @description apply:true moves the dependants shown by the preview (previewHash required); apply:false moves only this task
                         * @example {
                         *       "apply": true,
                         *       "previewHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
                         *     }
                         */
                        knockOn: {
                            apply: boolean;
                            previewHash?: string;
                        };
                    };
                };
            };
            responses: {
                /** @description Rescheduled (and, with knockOn.apply, its previewed dependants). 403 forbidden; 404 task_not_found; 409 version_conflict | knock_on_changed | knock_on_out_of_scope; 422 invalid_dates */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/date-proposal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description Tenant-local wall clock YYYY-MM-DDTHH:mm[:ss] (ruling D3)
                         * @example 2026-11-20T17:00:00
                         */
                        start: string;
                        /**
                         * @description Tenant-local wall clock YYYY-MM-DDTHH:mm[:ss] (ruling D3)
                         * @example 2026-11-20T17:00:00
                         */
                        due: string;
                        reason: string;
                    };
                };
            };
            responses: {
                /** @description An assignee proposes new dates; the managers in scope are told. 403 forbidden; 404 task_not_found; 422 invalid_dates */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/date-proposal/approve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        /**
                         * @description apply:true moves the dependants shown by the preview (previewHash required); apply:false moves only this task
                         * @example {
                         *       "apply": true,
                         *       "previewHash": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
                         *     }
                         */
                        knockOn: {
                            apply: boolean;
                            previewHash?: string;
                        };
                    };
                };
            };
            responses: {
                /** @description The proposal becomes a reschedule (knock-on rules apply). 403 forbidden; 404 task_not_found; 409 version_conflict | knock_on_changed | knock_on_out_of_scope; 422 no_proposal */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/date-proposal/decline": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        reason?: string;
                    };
                };
            };
            responses: {
                /** @description The proposal is cleared and the assignees are told. 403 forbidden; 404 task_not_found; 409 version_conflict; 422 no_proposal */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/evidence-rule": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        /**
                         * @example {
                         *       "mode": "none",
                         *       "types": [],
                         *       "min": 0,
                         *       "instruction": "",
                         *       "review": "manager"
                         *     }
                         */
                        rule: {
                            /** @enum {string} */
                            mode: "none" | "optional" | "required";
                            types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                            min: number;
                            instruction: string;
                            /** @enum {string} */
                            review: "auto" | "creator" | "manager" | "named";
                            reviewer?: string;
                        };
                    };
                };
            };
            responses: {
                /** @description The task with its new evidence rule (the creator or a manager; locked once submitted, completed or cancelled). 403 forbidden; 404 task_not_found; 409 version_conflict | evidence_locked | task_archived; 422 invalid_evidence_rule | invalid_reviewer (a named reviewer must be an active member with tasks:write) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/evidence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        kind: "photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive";
                        /**
                         * Format: uuid
                         * @description A `task_evidence` upload of THIS task, made by the caller (POST /v1/tasks/{id}/uploads, purpose evidence)
                         */
                        fileId?: string;
                        /** @description kind note. (kind checklist ignores it: the server writes `Checklist n/m` from the task's checklist) */
                        text?: string;
                        /** @description kind drive: a Google Drive or Docs link; needs the Drive device policy (403 device_policy) */
                        url?: string;
                        /** @enum {string} */
                        source?: "camera" | "upload";
                        /**
                         * Format: date-time
                         * @description The client's claim, checked against the server clock: not more than 5 minutes ahead, not older than 30 days (422 invalid_captured_at)
                         */
                        capturedAt?: string;
                    };
                };
            };
            responses: {
                /** @description The item (round of the task; pending review; a file item counts only once its file is clean). 403 forbidden | device_policy (Drive off the company PC); 404 task_not_found | file_not_found; 409 evidence_locked | file_infected; 422 evidence_type_not_allowed | invalid_evidence | invalid_captured_at; 400 for an unknown field such as location */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            kind: string;
                            name: string;
                            by: string;
                            at: string;
                            /** @enum {string} */
                            review: "pending" | "accepted" | "rejected";
                            reason?: string;
                            round: number;
                            locked: boolean;
                            source?: string;
                            capturedAt?: string;
                            url?: string;
                            size?: number;
                            fileId?: string;
                            /** @enum {string} */
                            fileStatus?: "pending" | "clean" | "infected" | "deleted";
                            reviewedBy?: string;
                            reviewedAt?: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/evidence/{evidenceId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    evidenceId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Removed (its uploader only, while unlocked); its file is deleted. 403 forbidden; 404 task_not_found | evidence_not_found; 409 evidence_locked */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/evidence/{evidenceId}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    evidenceId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Redirect to a 60 s presigned GET (file items, after the scan gate) or to the Drive link (on the company PC). 404 task_not_found | evidence_not_found (also a Drive item off the company PC, a note or a checklist); 409 file_not_ready; 410 file_infected */
                302: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/verify": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        /** @description Default: every pending item of the current round */
                        evidenceIds?: string[];
                    };
                };
            };
            responses: {
                /** @description The named (default: every pending) items are accepted; when none is left waiting the task is Completed. Audited. 403 human_required (API key) | self_verification (an assignee, or the uploader of a targeted item) | not_a_reviewer; 404 task_not_found | evidence_not_found; 409 version_conflict | invalid_transition (not submitted, or an item already reviewed) | evidence_not_ready | task_archived */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/tasks/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        reason: string;
                        /** @description Default: every pending item of the current round */
                        evidenceIds?: string[];
                    };
                };
            };
            responses: {
                /** @description The items are rejected (they stay as earlier versions), the task is Changes Requested in the next round, the reason becomes a comment and the assignees are told. Audited. Same independence rules and errors as verify */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            ref: string;
                            version: number;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee: string;
                            assignees: string[];
                            creator: string;
                            priority: number;
                            start: string;
                            due: string;
                            startAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            client?: string;
                            tags: string[];
                            estimate?: number;
                            projectId?: string;
                            milestoneId?: string;
                            parentRef?: string;
                            parentId: string | null;
                            checklist: {
                                id: string;
                                text: string;
                                done: boolean;
                            }[];
                            subtasks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            dependsOn: string[];
                            dependsOnIds: string[];
                            dependencies: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenDependencies: number;
                            blocks: {
                                id: string;
                                ref: string;
                                title: string;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            hiddenBlocks: number;
                            archivedAt?: string;
                            archivedBy?: string;
                            /**
                             * @example {
                             *       "start": "2026-11-21T09:00:00",
                             *       "due": "2026-11-21T17:00:00",
                             *       "reason": "Waiting on keys",
                             *       "by": "Ann Byrne",
                             *       "at": "2026-11-20T17:00:00"
                             *     }
                             */
                            proposal?: {
                                start: string;
                                due: string;
                                reason: string;
                                by: string;
                                at: string;
                            };
                            round: number;
                            /**
                             * @example {
                             *       "freq": "weekly",
                             *       "days": [
                             *         1,
                             *         3
                             *       ],
                             *       "until": "2026-12-31"
                             *     }
                             */
                            repeat?: {
                                /** @enum {string} */
                                freq: "daily" | "weekdays" | "weekly" | "monthly" | "per_shift";
                                patternId?: string;
                                days?: number[];
                                dayOfMonth?: number;
                                until?: string;
                            };
                            seriesId?: string;
                            submittedAt?: string;
                            completedAt?: string;
                            notes: {
                                at: string;
                                by: string;
                                text: string;
                                changes?: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified?: string[];
                                updateId?: string;
                            }[];
                            evidence: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                            }[];
                            timeline: {
                                id: string;
                                at: string;
                                atUtc: string;
                                actorId: string | null;
                                by: string;
                                kind: string;
                                text: string;
                                changes: {
                                    field: string;
                                    from: string;
                                    to: string;
                                }[];
                                notified: string[];
                                hiddenNotified: number;
                                hiddenDependencies: number;
                                updateId?: string;
                            }[];
                            overdue?: {
                                reason: string;
                                nextAction: string;
                                owner: string;
                                revisedDue: string;
                            };
                            timeEntries: {
                                id: string;
                                at: string;
                                by: string;
                                minutes: number;
                                note: string;
                                source: string;
                            }[];
                            evidenceState: string | null;
                            /**
                             * @example {
                             *       "durationSec": 12,
                             *       "mime": "audio/webm",
                             *       "recordedBy": "usr_8Kq2mZ4tW1",
                             *       "recordedAt": "2026-11-20T17:00:00.000Z"
                             *     }
                             */
                            voiceNote: {
                                durationSec: number;
                                mime: string;
                                recordedBy: string;
                                recordedAt: string;
                            } | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/evidence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    state?: "awaiting" | "verified" | "rejected";
                    teamId?: string;
                    /** @description A tenant-local calendar day (YYYY-MM-DD): the day the item was added */
                    date?: string;
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Evidence items of live tasks in the caller's scope, newest first (awaiting = pending on a submitted task with a clean file); pass nextCursor back as cursor. Drive links are withheld off the company PC. 400 invalid_cursor */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string;
                                kind: string;
                                name: string;
                                by: string;
                                at: string;
                                /** @enum {string} */
                                review: "pending" | "accepted" | "rejected";
                                reason?: string;
                                round: number;
                                locked: boolean;
                                source?: string;
                                capturedAt?: string;
                                url?: string;
                                size?: number;
                                fileId?: string;
                                /** @enum {string} */
                                fileStatus?: "pending" | "clean" | "infected" | "deleted";
                                reviewedBy?: string;
                                reviewedAt?: string;
                                taskId: string;
                                taskRef: string;
                                taskTitle: string;
                                taskStatus: string;
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/evidence/verify-batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        items: {
                            /** Format: uuid */
                            taskId: string;
                            /**
                             * @description The task's current version (optimistic lock, ruling D4); a stale one is 409 version_conflict
                             * @example 1
                             */
                            version: number;
                            evidenceIds?: string[];
                        }[];
                    };
                };
            };
            responses: {
                /** @description One result per item, in request order: verified, or failed with the code verify would have given. Each item is its own savepoint, so a refused one never rolls back the others. 403 human_required (API key) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                taskId: string;
                                /** @enum {string} */
                                status: "verified" | "failed";
                                code?: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Projects with milestones and progress, newest first; pass nextCursor back as cursor. Progress counts only live tasks inside the caller's task scope. 400 invalid_cursor */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                teamId: string | null;
                                dept: string;
                                leadId: string | null;
                                lead: string;
                                description: string;
                                due: string | null;
                                /**
                                 * @example {
                                 *       "mode": "required",
                                 *       "types": [
                                 *         "photo"
                                 *       ],
                                 *       "min": 1,
                                 *       "instruction": "",
                                 *       "review": "manager"
                                 *     }
                                 */
                                defaultEvidenceRule: {
                                    /** @enum {string} */
                                    mode: "none" | "optional" | "required";
                                    types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                    min: number;
                                    instruction: string;
                                    /** @enum {string} */
                                    review: "auto" | "creator" | "manager" | "named";
                                    reviewer?: string;
                                } | null;
                                createdAt: string;
                                updatedAt: string;
                                version: number;
                                progress: {
                                    done: number;
                                    total: number;
                                    pct: number;
                                };
                                milestones: {
                                    /** Format: uuid */
                                    id: string;
                                    name: string;
                                    due: string;
                                    position: number;
                                    /** @enum {string} */
                                    state: "done" | "late" | "open";
                                    done: number;
                                    total: number;
                                    pct: number;
                                }[];
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        /** Format: uuid */
                        teamId?: string | null;
                        leadId?: string | null;
                        /** @default  */
                        description?: string;
                        /**
                         * @description Tenant-local calendar day YYYY-MM-DD (ruling D3)
                         * @example 2026-12-18
                         */
                        due?: string | null;
                        /**
                         * @example {
                         *       "mode": "required",
                         *       "types": [
                         *         "photo"
                         *       ],
                         *       "min": 1,
                         *       "instruction": "",
                         *       "review": "manager"
                         *     }
                         */
                        defaultEvidenceRule?: {
                            /** @enum {string} */
                            mode: "none" | "optional" | "required";
                            types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                            min: number;
                            instruction: string;
                            /** @enum {string} */
                            review: "auto" | "creator" | "manager" | "named";
                            reviewer?: string;
                        } | null;
                    };
                };
            };
            responses: {
                /** @description The new project (managers only). 403 forbidden; 422 invalid_team | invalid_lead | invalid_evidence_rule | invalid_reviewer */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            teamId: string | null;
                            dept: string;
                            leadId: string | null;
                            lead: string;
                            description: string;
                            due: string | null;
                            /**
                             * @example {
                             *       "mode": "required",
                             *       "types": [
                             *         "photo"
                             *       ],
                             *       "min": 1,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            defaultEvidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            } | null;
                            createdAt: string;
                            updatedAt: string;
                            version: number;
                            progress: {
                                done: number;
                                total: number;
                                pct: number;
                            };
                            milestones: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                due: string;
                                position: number;
                                /** @enum {string} */
                                state: "done" | "late" | "open";
                                done: number;
                                total: number;
                                pct: number;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/projects/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The project. 404 project_not_found (also when the caller has no task in it and does not lead it) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            teamId: string | null;
                            dept: string;
                            leadId: string | null;
                            lead: string;
                            description: string;
                            due: string | null;
                            /**
                             * @example {
                             *       "mode": "required",
                             *       "types": [
                             *         "photo"
                             *       ],
                             *       "min": 1,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            defaultEvidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            } | null;
                            createdAt: string;
                            updatedAt: string;
                            version: number;
                            progress: {
                                done: number;
                                total: number;
                                pct: number;
                            };
                            milestones: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                due: string;
                                position: number;
                                /** @enum {string} */
                                state: "done" | "late" | "open";
                                done: number;
                                total: number;
                                pct: number;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted and audited; its tasks are unlinked (kept) and its milestones removed. 403 forbidden; 404 project_not_found */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The project's current version (optimistic lock); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        name?: string;
                        /** Format: uuid */
                        teamId?: string | null;
                        leadId?: string | null;
                        description?: string;
                        /**
                         * @description Tenant-local calendar day YYYY-MM-DD (ruling D3)
                         * @example 2026-12-18
                         */
                        due?: string | null;
                        /**
                         * @example {
                         *       "mode": "required",
                         *       "types": [
                         *         "photo"
                         *       ],
                         *       "min": 1,
                         *       "instruction": "",
                         *       "review": "manager"
                         *     }
                         */
                        defaultEvidenceRule?: {
                            /** @enum {string} */
                            mode: "none" | "optional" | "required";
                            types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                            min: number;
                            instruction: string;
                            /** @enum {string} */
                            review: "auto" | "creator" | "manager" | "named";
                            reviewer?: string;
                        } | null;
                    };
                };
            };
            responses: {
                /** @description The updated project (managers only). 403 forbidden; 404 project_not_found; 409 version_conflict; 422 invalid_team | invalid_lead | invalid_evidence_rule */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            teamId: string | null;
                            dept: string;
                            leadId: string | null;
                            lead: string;
                            description: string;
                            due: string | null;
                            /**
                             * @example {
                             *       "mode": "required",
                             *       "types": [
                             *         "photo"
                             *       ],
                             *       "min": 1,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            defaultEvidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            } | null;
                            createdAt: string;
                            updatedAt: string;
                            version: number;
                            progress: {
                                done: number;
                                total: number;
                                pct: number;
                            };
                            milestones: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                due: string;
                                position: number;
                                /** @enum {string} */
                                state: "done" | "late" | "open";
                                done: number;
                                total: number;
                                pct: number;
                            }[];
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/projects/{id}/milestones": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        /**
                         * @description Tenant-local calendar day YYYY-MM-DD (ruling D3)
                         * @example 2026-12-18
                         */
                        due: string;
                    };
                };
            };
            responses: {
                /** @description The new milestone (managers only). 403 forbidden; 404 project_not_found */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            due: string;
                            position: number;
                            /** @enum {string} */
                            state: "done" | "late" | "open";
                            done: number;
                            total: number;
                            pct: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/projects/{id}/milestones/{milestoneId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    milestoneId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted; its tasks are unlinked from it. 403 forbidden; 404 project_not_found | milestone_not_found */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    milestoneId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name?: string;
                        /**
                         * @description Tenant-local calendar day YYYY-MM-DD (ruling D3)
                         * @example 2026-12-18
                         */
                        due?: string;
                        position?: number;
                    };
                };
            };
            responses: {
                /** @description The milestone. A new date tells the assignees of its open tasks. 403 forbidden; 404 project_not_found | milestone_not_found */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            due: string;
                            position: number;
                            /** @enum {string} */
                            state: "done" | "late" | "open";
                            done: number;
                            total: number;
                            pct: number;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/task-templates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Templates by name; pass nextCursor back as cursor. 400 invalid_cursor */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                title: string;
                                description: string;
                                dept: string;
                                teamId: string | null;
                                assignee?: string;
                                priority: number;
                                tags: string[];
                                /**
                                 * @example {
                                 *       "mode": "none",
                                 *       "types": [],
                                 *       "min": 0,
                                 *       "instruction": "",
                                 *       "review": "manager"
                                 *     }
                                 */
                                evidenceRule: {
                                    /** @enum {string} */
                                    mode: "none" | "optional" | "required";
                                    types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                    min: number;
                                    instruction: string;
                                    /** @enum {string} */
                                    review: "auto" | "creator" | "manager" | "named";
                                    reviewer?: string;
                                };
                                dueOffset: number;
                                dueTime: string;
                                createdBy: string | null;
                                createdAt: string;
                                version: number;
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        title: string;
                        /** @default  */
                        description?: string;
                        /** Format: uuid */
                        teamId?: string | null;
                        assignee?: string | null;
                        /** @default 2 */
                        priority?: number;
                        /** @default [] */
                        tags?: string[];
                        /**
                         * @example {
                         *       "mode": "none",
                         *       "types": [],
                         *       "min": 0,
                         *       "instruction": "",
                         *       "review": "manager"
                         *     }
                         */
                        evidenceRule?: {
                            /** @enum {string} */
                            mode: "none" | "optional" | "required";
                            types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                            min: number;
                            instruction: string;
                            /** @enum {string} */
                            review: "auto" | "creator" | "manager" | "named";
                            reviewer?: string;
                        };
                        /** @default 0 */
                        dueOffset?: number;
                        /**
                         * @description Tenant-local HH:mm
                         * @default 17:00
                         * @example 17:00
                         */
                        dueTime?: string;
                    };
                };
            };
            responses: {
                /** @description The new template (managers only). 403 forbidden; 422 invalid_team | invalid_assignee | assignee_out_of_scope | invalid_labels | invalid_evidence_rule | invalid_reviewer */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee?: string;
                            priority: number;
                            tags: string[];
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            dueOffset: number;
                            dueTime: string;
                            createdBy: string | null;
                            createdAt: string;
                            version: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/task-templates/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted and audited (managers only). 403 forbidden; 404 template_not_found */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description The template's current version (optimistic lock); a stale one is 409 version_conflict
                         * @example 1
                         */
                        version: number;
                        name?: string;
                        title?: string;
                        description?: string;
                        /** Format: uuid */
                        teamId?: string | null;
                        assignee?: string | null;
                        priority?: number;
                        tags?: string[];
                        /**
                         * @example {
                         *       "mode": "none",
                         *       "types": [],
                         *       "min": 0,
                         *       "instruction": "",
                         *       "review": "manager"
                         *     }
                         */
                        evidenceRule?: {
                            /** @enum {string} */
                            mode: "none" | "optional" | "required";
                            types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                            min: number;
                            instruction: string;
                            /** @enum {string} */
                            review: "auto" | "creator" | "manager" | "named";
                            reviewer?: string;
                        };
                        dueOffset?: number;
                        /**
                         * @description Tenant-local HH:mm
                         * @example 17:00
                         */
                        dueTime?: string;
                    };
                };
            };
            responses: {
                /** @description The updated template (managers only). 403 forbidden; 404 template_not_found; 409 version_conflict; 422 as for create */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            title: string;
                            description: string;
                            dept: string;
                            teamId: string | null;
                            assignee?: string;
                            priority: number;
                            tags: string[];
                            /**
                             * @example {
                             *       "mode": "none",
                             *       "types": [],
                             *       "min": 0,
                             *       "instruction": "",
                             *       "review": "manager"
                             *     }
                             */
                            evidenceRule: {
                                /** @enum {string} */
                                mode: "none" | "optional" | "required";
                                types: ("photo" | "image" | "pdf" | "office" | "video" | "checklist" | "signature" | "note" | "drive")[];
                                min: number;
                                instruction: string;
                                /** @enum {string} */
                                review: "auto" | "creator" | "manager" | "named";
                                reviewer?: string;
                            };
                            dueOffset: number;
                            dueTime: string;
                            createdBy: string | null;
                            createdAt: string;
                            version: number;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/shifts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Live patterns, assignments (open or ended within 92 days), active members with team ids and primary manager, and the reporting settings. A staff-home caller gets only their own cut (own assignments, their patterns, own override, their teams' defaults, own primary manager) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            patterns: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                /** Format: uuid */
                                teamId: string;
                                start: string;
                                end: string;
                                days: number[];
                                timeZone: string | null;
                                version: number;
                            }[];
                            assignments: {
                                /** Format: uuid */
                                id: string;
                                userId: string;
                                /** Format: uuid */
                                patternId: string;
                                from: string;
                                until: string | null;
                            }[];
                            members: {
                                userId: string;
                                teams: string[];
                                managerId: string | null;
                            }[];
                            reporting: {
                                dueAfterMinutes: number;
                                teamDefaults: {
                                    [key: string]: boolean;
                                };
                                overrides: {
                                    [key: string]: boolean;
                                };
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shifts/occurrences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    /** @description First shift START date, YYYY-MM-DD (in the pattern's own zone) */
                    from: string;
                    /** @description Last shift START date, inclusive; at most 31 dates from `from` */
                    to: string;
                    /** @description One member (staff see only their own shifts whatever is asked) */
                    userId?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Shifts that START between from and to (a shift belongs to its start date in the pattern's zone; instants are UTC; start/end are tenant wall clock). 422 invalid_range | range_too_long (31 dates). Staff see only their own */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                userId: string;
                                /** Format: uuid */
                                patternId: string;
                                name: string;
                                /** Format: uuid */
                                teamId: string;
                                shiftDate: string;
                                start: string;
                                end: string;
                                startAt: string;
                                endAt: string;
                                minutes: number;
                                endsNextDay: boolean;
                                reportsOn: boolean;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shifts/patterns": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        /** Format: uuid */
                        teamId: string;
                        start: string;
                        end: string;
                        days: number[];
                        timeZone?: string | null;
                    };
                };
            };
            responses: {
                /** @description The new pattern (all-scope managers only: 403 forbidden for a team-scope manager). 404 team_not_found; 409 pattern_name_taken; 422 invalid_pattern | invalid_pattern_zone */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            /** Format: uuid */
                            teamId: string;
                            start: string;
                            end: string;
                            days: number[];
                            timeZone: string | null;
                            version: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shifts/patterns/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The pattern is archived (never deleted): no new shifts or assignments; reports, history and assignment rows stay. 404 shift_pattern_not_found */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        version: number;
                        name?: string;
                        /** Format: uuid */
                        teamId?: string;
                        start?: string;
                        end?: string;
                        days?: number[];
                        timeZone?: string | null;
                    };
                };
            };
            responses: {
                /** @description The updated pattern; only shifts not yet reported change (all-scope managers only). 404 shift_pattern_not_found | team_not_found; 409 version_conflict | pattern_name_taken; 422 invalid_pattern | invalid_pattern_zone */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            /** Format: uuid */
                            teamId: string;
                            start: string;
                            end: string;
                            days: number[];
                            timeZone: string | null;
                            version: number;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/shifts/assignments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        userId: string;
                        /** Format: uuid */
                        patternId: string;
                        from: string;
                        until?: string | null;
                    };
                };
            };
            responses: {
                /** @description The new assignment. 404 shift_pattern_not_found; 422 invalid_assignment (not an active member with reports or tasks access, an archived pattern, bad dates or an overlap with another assignment of the same member and pattern) | assignee_out_of_scope (team-scope manager: only themself and their direct reports) */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            userId: string;
                            /** Format: uuid */
                            patternId: string;
                            from: string;
                            until: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shifts/assignments/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted (only while its from date is after today). 404 shift_assignment_not_found; 409 assignment_started */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        until: string | null;
                    };
                };
            };
            responses: {
                /** @description The assignment with its new end date (history kept); null re-opens it. 404 shift_assignment_not_found; 422 invalid_assignment */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            userId: string;
                            /** Format: uuid */
                            patternId: string;
                            from: string;
                            until: string | null;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/shifts/reporting/teams/{teamId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    teamId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        on: boolean;
                    };
                };
            };
            responses: {
                /** @description The team default for end-of-shift reporting (all-scope managers only). 404 team_not_found */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            teamId: string;
                            on: boolean;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shifts/reporting/people/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    userId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        on: boolean | null;
                    };
                };
            };
            responses: {
                /** @description A per-person override; null follows the team default again. 404 not_a_member; 422 assignee_out_of_scope (team-scope manager: only themself and their direct reports) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            userId: string;
                            on: boolean | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/locations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    /** @description Also list archived locations (default false) */
                    includeArchived?: "true" | "false";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The locations the caller may see (a supervisor: only the granted ones; an office role with an except list: all but those; staff: none). Archived ones only with includeArchived=true */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                name: string;
                                address: string;
                                lat: number | null;
                                lng: number | null;
                                zoneRadiusM: number | null;
                                openingHours: {
                                    [key: string]: string;
                                };
                                contact: string;
                                swapApprovalDelegated: boolean;
                                timeZone: string | null;
                                version: number;
                                archived: boolean;
                                supervisorIds: string[];
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        address?: string;
                        lat?: number | null;
                        lng?: number | null;
                        zoneRadiusM?: number | null;
                        openingHours?: {
                            [key: string]: string;
                        };
                        contact?: string;
                        swapApprovalDelegated?: boolean;
                        timeZone?: string | null;
                    };
                };
            };
            responses: {
                /** @description The new location (office roster roles only: 403 forbidden). 409 location_name_taken; 422 invalid_location | invalid_coordinates | invalid_zone_radius (0..5000 m) | invalid_time_zone (not an IANA zone) */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            address: string;
                            lat: number | null;
                            lng: number | null;
                            zoneRadiusM: number | null;
                            openingHours: {
                                [key: string]: string;
                            };
                            contact: string;
                            swapApprovalDelegated: boolean;
                            timeZone: string | null;
                            version: number;
                            archived: boolean;
                            supervisorIds: string[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/locations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description One location with its active supervisor ids. 404 not_found for a location the caller may not see, one that does not exist, another tenant's and an id that is not a uuid (all the same answer) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            address: string;
                            lat: number | null;
                            lng: number | null;
                            zoneRadiusM: number | null;
                            openingHours: {
                                [key: string]: string;
                            };
                            contact: string;
                            swapApprovalDelegated: boolean;
                            timeZone: string | null;
                            version: number;
                            archived: boolean;
                            supervisorIds: string[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        version: number;
                        name?: string;
                        address?: string;
                        lat?: number | null;
                        lng?: number | null;
                        zoneRadiusM?: number | null;
                        openingHours?: {
                            [key: string]: string;
                        };
                        contact?: string;
                        swapApprovalDelegated?: boolean;
                        timeZone?: string | null;
                    };
                };
            };
            responses: {
                /** @description The updated location (office only). A changed time zone recomputes DRAFT shifts only. 404 not_found for a location the caller may not see, one that does not exist, another tenant's and an id that is not a uuid (all the same answer); 409 version_conflict | location_name_taken | location_archived; 422 as POST */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            address: string;
                            lat: number | null;
                            lng: number | null;
                            zoneRadiusM: number | null;
                            openingHours: {
                                [key: string]: string;
                            };
                            contact: string;
                            swapApprovalDelegated: boolean;
                            timeZone: string | null;
                            version: number;
                            archived: boolean;
                            supervisorIds: string[];
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/locations/{id}/archive": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The location is archived, never deleted (office only; repeat is a 200). 404 not_found for a location the caller may not see, one that does not exist, another tenant's and an id that is not a uuid (all the same answer) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            name: string;
                            address: string;
                            lat: number | null;
                            lng: number | null;
                            zoneRadiusM: number | null;
                            openingHours: {
                                [key: string]: string;
                            };
                            contact: string;
                            swapApprovalDelegated: boolean;
                            timeZone: string | null;
                            version: number;
                            archived: boolean;
                            supervisorIds: string[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/locations/{id}/supervisors": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        userIds: string[];
                    };
                };
            };
            responses: {
                /** @description The supervisor set of the location, replaced (office only). An unchanged set writes nothing. 404 not_found for a location the caller may not see, one that does not exist, another tenant's and an id that is not a uuid (all the same answer); 409 location_archived; 422 invalid_supervisor (not an active member) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            locationId: string;
                            userIds: string[];
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/locations/{id}/shift-types": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    /** @description Also list archived types (default false); rostered shifts keep their type either way */
                    includeArchived?: "true" | "false";
                };
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The shift types of the location with their weekday targets. 404 not_found for a location the caller may not see, one that does not exist, another tenant's and an id that is not a uuid (all the same answer) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                locationId: string;
                                name: string;
                                start: string;
                                end: string;
                                unpaidBreakMin: number;
                                role: string;
                                requires: string[];
                                targets: {
                                    weekday: number;
                                    count: number;
                                }[];
                                archived: boolean;
                                version: number;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        start: string;
                        end: string;
                        unpaidBreakMin?: number;
                        role: string;
                        requires?: string[];
                    };
                };
            };
            responses: {
                /** @description The new shift type (office only). end before start is overnight; start equal to end is refused. 404 not_found for a location the caller may not see, one that does not exist, another tenant's and an id that is not a uuid (all the same answer); 409 shift_type_name_taken | location_archived; 422 invalid_shift_type */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            locationId: string;
                            name: string;
                            start: string;
                            end: string;
                            unpaidBreakMin: number;
                            role: string;
                            requires: string[];
                            targets: {
                                weekday: number;
                                count: number;
                            }[];
                            archived: boolean;
                            version: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-types/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The shift type is archived (never deleted, always succeeds, repeat included); shifts that use it keep reading it. 404 not_found for a location the caller may not see, one that does not exist, another tenant's and an id that is not a uuid (all the same answer) */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        version: number;
                        name?: string;
                        start?: string;
                        end?: string;
                        unpaidBreakMin?: number;
                        role?: string;
                        requires?: string[];
                    };
                };
            };
            responses: {
                /** @description The updated shift type (office only; shifts already rostered keep their copy). 404 not_found for a location the caller may not see, one that does not exist, another tenant's and an id that is not a uuid (all the same answer); 409 version_conflict | shift_type_name_taken | shift_type_archived; 422 invalid_shift_type */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            locationId: string;
                            name: string;
                            start: string;
                            end: string;
                            unpaidBreakMin: number;
                            role: string;
                            requires: string[];
                            targets: {
                                weekday: number;
                                count: number;
                            }[];
                            archived: boolean;
                            version: number;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/shift-types/{id}/targets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        targets: {
                            weekday: number;
                            count: number;
                        }[];
                    };
                };
            };
            responses: {
                /** @description The staffing target per weekday (0 = Sunday ... 6, count 0..99), replacing the whole set (office only). 404 not_found for a location the caller may not see, one that does not exist, another tenant's and an id that is not a uuid (all the same answer); 409 shift_type_archived; 422 invalid_targets */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** Format: uuid */
                            locationId: string;
                            name: string;
                            start: string;
                            end: string;
                            unpaidBreakMin: number;
                            role: string;
                            requires: string[];
                            targets: {
                                weekday: number;
                                count: number;
                            }[];
                            archived: boolean;
                            version: number;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/members/{userId}/qualifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    userId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The person's qualifications with `expired` computed on the clock (valid through the expiry date). Read: the person, an office role, a supervisor of a location the person is homed or rostered at. 404 member_not_found for a person who does not exist, is of another tenant or out of the caller's reach */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            userId: string;
                            items: {
                                type: string;
                                expiresOn: string | null;
                                expired: boolean;
                            }[];
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    userId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        qualifications: {
                            type: string;
                            expiresOn?: string | null;
                        }[];
                    };
                };
            };
            responses: {
                /** @description The person's whole set of qualifications, replaced (office only: 403 forbidden). Types are free-text keys, trimmed and unique (max 50); an unchanged set writes nothing. 404 member_not_found; 422 invalid_qualification */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            userId: string;
                            items: {
                                type: string;
                                expiresOn: string | null;
                                expired: boolean;
                            }[];
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/members/{userId}/home-location": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    userId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        locationId: string | null;
                    };
                };
            };
            responses: {
                /** @description The person's home location (null clears it; office only). 404 member_not_found | not_found (a location the caller may not see, missing, another tenant's or not a uuid: one answer); 409 location_archived */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            userId: string;
                            /** Format: uuid */
                            homeLocationId: string | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/roster/office-limits/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    userId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        except: string[];
                    };
                };
            };
            responses: {
                /** @description The sites a Roster Manager does NOT manage (an office role with no limit of its own only: 403 forbidden). 404 member_not_found; 422 not_roster_office (not an active member with office level and roster write) | invalid_location */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            userId: string;
                            except: string[];
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/members/{userId}/deactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    userId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The member is deactivated (owner or admin: settings write): they cannot reach the workspace, keep their history and shifts, their open shift assignments end today and their pending roster requests are closed. Sessions are revoked when this was their last workspace. 404 member_not_found; 403 role_escalation (acting on a role above yours); 409 already_deactivated; 422 last_owner | self_deactivation */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            userId: string;
                            /** @enum {string} */
                            status: "active" | "deactivated";
                            deactivatedAt: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/members/{userId}/reactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    userId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The member is active again (needs a free seat). 404 member_not_found; 403 role_escalation; 409 not_deactivated | seat_limit */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            userId: string;
                            /** @enum {string} */
                            status: "active" | "deactivated";
                            deactivatedAt: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports/current": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The caller's OWN running shift, else the last ended one that was not submitted, else null (instants, never wall strings). `reportId` is null until the report is opened. Reporting must be on for the shift's team */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            item: {
                                key: string;
                                shiftName: string;
                                shiftDate: string;
                                startAt: string;
                                endAt: string;
                                dueAt: string;
                                state: string;
                                reportId: string | null;
                            } | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    from?: string;
                    to?: string;
                    team?: string;
                    person?: string;
                    status?: "all" | "draft" | "submitted" | "late" | "missing" | "accepted" | "returned";
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The inbox: stored reports AND virtual rows (assigned, reporting on, started, no report yet: id null, state draft or missing) of the window, newest shift date first then member then pattern, in the caller's scope only (own, direct reports for a team manager, all for others; a person or team filter can only narrow it, never 403). No free text. from/to default to the last 7 tenant-local days, at most 31 days (422 range_too_long | invalid_range); status all|draft|submitted|late|missing|accepted|returned; 400 invalid_cursor */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string | null;
                                key: string;
                                userId: string;
                                person: string;
                                patternId: string;
                                teamId: string;
                                shiftName: string;
                                team: string;
                                date: string;
                                start: string;
                                end: string;
                                due: string;
                                startAt: string;
                                endAt: string;
                                dueAt: string;
                                /** @enum {string} */
                                status: "draft" | "submitted" | "accepted" | "returned";
                                /** @enum {string} */
                                state: "draft" | "submitted" | "late" | "missing" | "accepted" | "returned";
                                version: number;
                                submissions: number;
                                itemCount: number;
                                doneCount: number;
                                submittedAt: string | null;
                                reviewedAt: string | null;
                                reviewedBy: string | null;
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports/template": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The report templates of the TEAMS IN THE CALLER'S SCOPE (a department is matched to a team by name; a team with no entry shows the one it is validated against). custom false = the default from the onboarding data. The `ETag` header (strong, quoted) names the STORED template, the same for every caller: send it back as `If-Match` on the PUT */
                200: {
                    headers: {
                        /** @description Strong ETag of the stored template */
                        ETag?: string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            custom: boolean;
                            departments: {
                                dept: string;
                                sections: {
                                    id: string;
                                    title: string;
                                    enabled: boolean;
                                    fields: {
                                        id: string;
                                        label: string;
                                        required: boolean;
                                    }[];
                                }[];
                            }[];
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: {
                    /** @description The ETag of the template the edit started from (GET /template). Required: missing is 428 precondition_required, stale is 412 precondition_failed (the current ETag in the ETag header). Strong comparison; a weak tag or * never matches */
                    "if-match"?: string;
                };
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        departments: {
                            dept: string;
                            sections: {
                                id: string;
                                title: string;
                                enabled: boolean;
                                fields: {
                                    id: string;
                                    label: string;
                                    required: boolean;
                                }[];
                            }[];
                        }[];
                    };
                };
            };
            responses: {
                /** @description Replaces the whole template (at most 50 departments, 12 sections of 12 fields, ids [a-z0-9_]{1,40}); applies to NEW submissions only. Audited. 400 validation_failed; 422 invalid_template (duplicate ids, or a field a built-in section does not have) with errors[{key,message}]. 428 precondition_required (no If-Match) and 412 precondition_failed (stale If-Match) are decided under the settings lock; the new ETag is in the ETag header */
                200: {
                    headers: {
                        /** @description Strong ETag of the stored template */
                        ETag?: string;
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            custom: boolean;
                            departments: {
                                dept: string;
                                sections: {
                                    id: string;
                                    title: string;
                                    enabled: boolean;
                                    fields: {
                                        id: string;
                                        label: string;
                                        required: boolean;
                                    }[];
                                }[];
                            }[];
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports/open": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        patternId: string;
                        date: string;
                    };
                };
            };
            responses: {
                /** @description The report already existed (idempotent on member, pattern and shift date) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            userId: string | null;
                            patternId: string;
                            shiftName: string;
                            team: string;
                            date: string;
                            start: string;
                            end: string;
                            due: string;
                            startAt: string;
                            endAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "draft" | "submitted" | "accepted" | "returned";
                            /** @enum {string} */
                            state: "draft" | "submitted" | "late" | "missing" | "accepted" | "returned";
                            version: number;
                            submissions: number;
                            items: {
                                position: number;
                                taskId: string | null;
                                ref: string;
                                title: string;
                                due: string;
                                dueAt: string;
                                /** @enum {string} */
                                status: "done" | "in_progress" | "blocked" | "not_started";
                                minutes: number;
                                note: string;
                                taskStatus: string | null;
                                evidenceState: string | null;
                                /** @enum {string} */
                                outcome?: "applied" | "needs_evidence" | "submitted_for_review" | "skipped_archived" | "skipped_unavailable";
                            }[];
                            summary: string;
                            blockers: string;
                            unplanned: {
                                id: string;
                                text: string;
                                minutes: number;
                            }[];
                            extra: {
                                [key: string]: string;
                            };
                            attachments: {
                                id: string;
                                name: string;
                                /** @enum {string} */
                                kind: "image" | "file";
                                size: number;
                                /** @enum {string} */
                                status: "pending" | "clean" | "infected";
                            }[];
                            submittedAt: string | null;
                            reviewedAt: string | null;
                            reviewedBy: string | null;
                            comments: {
                                at: string;
                                by: string;
                                text: string;
                            }[];
                        };
                    };
                };
                /** @description The caller's own draft was created; its rows are the shift's tasks. 404 shift_not_found (not assigned, not a pattern day, a live pattern of someone else, or the shift has not started); 422 reporting_off */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            userId: string | null;
                            patternId: string;
                            shiftName: string;
                            team: string;
                            date: string;
                            start: string;
                            end: string;
                            due: string;
                            startAt: string;
                            endAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "draft" | "submitted" | "accepted" | "returned";
                            /** @enum {string} */
                            state: "draft" | "submitted" | "late" | "missing" | "accepted" | "returned";
                            version: number;
                            submissions: number;
                            items: {
                                position: number;
                                taskId: string | null;
                                ref: string;
                                title: string;
                                due: string;
                                dueAt: string;
                                /** @enum {string} */
                                status: "done" | "in_progress" | "blocked" | "not_started";
                                minutes: number;
                                note: string;
                                taskStatus: string | null;
                                evidenceState: string | null;
                                /** @enum {string} */
                                outcome?: "applied" | "needs_evidence" | "submitted_for_review" | "skipped_archived" | "skipped_unavailable";
                            }[];
                            summary: string;
                            blockers: string;
                            unplanned: {
                                id: string;
                                text: string;
                                minutes: number;
                            }[];
                            extra: {
                                [key: string]: string;
                            };
                            attachments: {
                                id: string;
                                name: string;
                                /** @enum {string} */
                                kind: "image" | "file";
                                size: number;
                                /** @enum {string} */
                                status: "pending" | "clean" | "infected";
                            }[];
                            submittedAt: string | null;
                            reviewedAt: string | null;
                            reviewedBy: string | null;
                            comments: {
                                at: string;
                                by: string;
                                text: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The report with live task state and evidence state per row. 404 report_not_found (also outside the caller's scope: own, direct reports for a team manager, all for others). Drive links are withheld off the company PC */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            userId: string | null;
                            patternId: string;
                            shiftName: string;
                            team: string;
                            date: string;
                            start: string;
                            end: string;
                            due: string;
                            startAt: string;
                            endAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "draft" | "submitted" | "accepted" | "returned";
                            /** @enum {string} */
                            state: "draft" | "submitted" | "late" | "missing" | "accepted" | "returned";
                            version: number;
                            submissions: number;
                            items: {
                                position: number;
                                taskId: string | null;
                                ref: string;
                                title: string;
                                due: string;
                                dueAt: string;
                                /** @enum {string} */
                                status: "done" | "in_progress" | "blocked" | "not_started";
                                minutes: number;
                                note: string;
                                taskStatus: string | null;
                                evidenceState: string | null;
                                /** @enum {string} */
                                outcome?: "applied" | "needs_evidence" | "submitted_for_review" | "skipped_archived" | "skipped_unavailable";
                            }[];
                            summary: string;
                            blockers: string;
                            unplanned: {
                                id: string;
                                text: string;
                                minutes: number;
                            }[];
                            extra: {
                                [key: string]: string;
                            };
                            attachments: {
                                id: string;
                                name: string;
                                /** @enum {string} */
                                kind: "image" | "file";
                                size: number;
                                /** @enum {string} */
                                status: "pending" | "clean" | "infected";
                            }[];
                            submittedAt: string | null;
                            reviewedAt: string | null;
                            reviewedBy: string | null;
                            comments: {
                                at: string;
                                by: string;
                                text: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports/{id}/draft": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        version: number;
                        items: {
                            /** Format: uuid */
                            taskId: string;
                            /** @enum {string} */
                            status: "done" | "in_progress" | "blocked" | "not_started";
                            minutes: number;
                            note: string;
                        }[];
                        summary: string;
                        blockers: string;
                        unplanned: {
                            id: string;
                            text: string;
                            minutes: number;
                        }[];
                        extra: {
                            [key: string]: string;
                        };
                        attachmentFileIds?: string[];
                    };
                };
            };
            responses: {
                /** @description The saved draft (version + 1). Owner only: 403 forbidden for any other reader. 404 report_not_found | report_file_not_found; 409 version_conflict | report_locked (submitted or accepted); 422 item_not_in_shift */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            userId: string | null;
                            patternId: string;
                            shiftName: string;
                            team: string;
                            date: string;
                            start: string;
                            end: string;
                            due: string;
                            startAt: string;
                            endAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "draft" | "submitted" | "accepted" | "returned";
                            /** @enum {string} */
                            state: "draft" | "submitted" | "late" | "missing" | "accepted" | "returned";
                            version: number;
                            submissions: number;
                            items: {
                                position: number;
                                taskId: string | null;
                                ref: string;
                                title: string;
                                due: string;
                                dueAt: string;
                                /** @enum {string} */
                                status: "done" | "in_progress" | "blocked" | "not_started";
                                minutes: number;
                                note: string;
                                taskStatus: string | null;
                                evidenceState: string | null;
                                /** @enum {string} */
                                outcome?: "applied" | "needs_evidence" | "submitted_for_review" | "skipped_archived" | "skipped_unavailable";
                            }[];
                            summary: string;
                            blockers: string;
                            unplanned: {
                                id: string;
                                text: string;
                                minutes: number;
                            }[];
                            extra: {
                                [key: string]: string;
                            };
                            attachments: {
                                id: string;
                                name: string;
                                /** @enum {string} */
                                kind: "image" | "file";
                                size: number;
                                /** @enum {string} */
                                status: "pending" | "clean" | "infected";
                            }[];
                            submittedAt: string | null;
                            reviewedAt: string | null;
                            reviewedBy: string | null;
                            comments: {
                                at: string;
                                by: string;
                                text: string;
                            }[];
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports/{id}/submit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        version: number;
                        /** Format: uuid */
                        requestId: string;
                    };
                };
            };
            responses: {
                /** @description Submitted (or the stored result of an earlier call with the same requestId: no new version). Updates the tasks of the rows. Owner only, a person (never an API key). 403 forbidden | human_required; 404 report_not_found; 409 version_conflict | report_locked | retry; 422 report_invalid with errors[{key,message}] */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            userId: string | null;
                            patternId: string;
                            shiftName: string;
                            team: string;
                            date: string;
                            start: string;
                            end: string;
                            due: string;
                            startAt: string;
                            endAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "draft" | "submitted" | "accepted" | "returned";
                            /** @enum {string} */
                            state: "draft" | "submitted" | "late" | "missing" | "accepted" | "returned";
                            version: number;
                            submissions: number;
                            items: {
                                position: number;
                                taskId: string | null;
                                ref: string;
                                title: string;
                                due: string;
                                dueAt: string;
                                /** @enum {string} */
                                status: "done" | "in_progress" | "blocked" | "not_started";
                                minutes: number;
                                note: string;
                                taskStatus: string | null;
                                evidenceState: string | null;
                                /** @enum {string} */
                                outcome?: "applied" | "needs_evidence" | "submitted_for_review" | "skipped_archived" | "skipped_unavailable";
                            }[];
                            summary: string;
                            blockers: string;
                            unplanned: {
                                id: string;
                                text: string;
                                minutes: number;
                            }[];
                            extra: {
                                [key: string]: string;
                            };
                            attachments: {
                                id: string;
                                name: string;
                                /** @enum {string} */
                                kind: "image" | "file";
                                size: number;
                                /** @enum {string} */
                                status: "pending" | "clean" | "infected";
                            }[];
                            submittedAt: string | null;
                            reviewedAt: string | null;
                            reviewedBy: string | null;
                            comments: {
                                at: string;
                                by: string;
                                text: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports/{id}/accept": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        version: number;
                        comment?: string;
                    };
                };
            };
            responses: {
                /** @description Accepted: the reviewer is the caller, the member is told. Manager-home roles only, a person (never an API key), NEVER the report's own member. 403 forbidden | human_required | self_review; 404 report_not_found (also outside the caller's scope); 409 version_conflict | report_not_submitted | retry */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            userId: string | null;
                            patternId: string;
                            shiftName: string;
                            team: string;
                            date: string;
                            start: string;
                            end: string;
                            due: string;
                            startAt: string;
                            endAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "draft" | "submitted" | "accepted" | "returned";
                            /** @enum {string} */
                            state: "draft" | "submitted" | "late" | "missing" | "accepted" | "returned";
                            version: number;
                            submissions: number;
                            items: {
                                position: number;
                                taskId: string | null;
                                ref: string;
                                title: string;
                                due: string;
                                dueAt: string;
                                /** @enum {string} */
                                status: "done" | "in_progress" | "blocked" | "not_started";
                                minutes: number;
                                note: string;
                                taskStatus: string | null;
                                evidenceState: string | null;
                                /** @enum {string} */
                                outcome?: "applied" | "needs_evidence" | "submitted_for_review" | "skipped_archived" | "skipped_unavailable";
                            }[];
                            summary: string;
                            blockers: string;
                            unplanned: {
                                id: string;
                                text: string;
                                minutes: number;
                            }[];
                            extra: {
                                [key: string]: string;
                            };
                            attachments: {
                                id: string;
                                name: string;
                                /** @enum {string} */
                                kind: "image" | "file";
                                size: number;
                                /** @enum {string} */
                                status: "pending" | "clean" | "infected";
                            }[];
                            submittedAt: string | null;
                            reviewedAt: string | null;
                            reviewedBy: string | null;
                            comments: {
                                at: string;
                                by: string;
                                text: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports/{id}/return": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        version: number;
                        comment?: string;
                    };
                };
            };
            responses: {
                /** @description Returned with a comment (1-2000 characters): the member edits and resubmits into the next version. Same rules as accept. 422 comment_required; 403 forbidden | human_required | self_review; 404 report_not_found; 409 version_conflict | report_not_submitted | retry */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            key: string;
                            userId: string | null;
                            patternId: string;
                            shiftName: string;
                            team: string;
                            date: string;
                            start: string;
                            end: string;
                            due: string;
                            startAt: string;
                            endAt: string;
                            dueAt: string;
                            /** @enum {string} */
                            status: "draft" | "submitted" | "accepted" | "returned";
                            /** @enum {string} */
                            state: "draft" | "submitted" | "late" | "missing" | "accepted" | "returned";
                            version: number;
                            submissions: number;
                            items: {
                                position: number;
                                taskId: string | null;
                                ref: string;
                                title: string;
                                due: string;
                                dueAt: string;
                                /** @enum {string} */
                                status: "done" | "in_progress" | "blocked" | "not_started";
                                minutes: number;
                                note: string;
                                taskStatus: string | null;
                                evidenceState: string | null;
                                /** @enum {string} */
                                outcome?: "applied" | "needs_evidence" | "submitted_for_review" | "skipped_archived" | "skipped_unavailable";
                            }[];
                            summary: string;
                            blockers: string;
                            unplanned: {
                                id: string;
                                text: string;
                                minutes: number;
                            }[];
                            extra: {
                                [key: string]: string;
                            };
                            attachments: {
                                id: string;
                                name: string;
                                /** @enum {string} */
                                kind: "image" | "file";
                                size: number;
                                /** @enum {string} */
                                status: "pending" | "clean" | "infected";
                            }[];
                            submittedAt: string | null;
                            reviewedAt: string | null;
                            reviewedBy: string | null;
                            comments: {
                                at: string;
                                by: string;
                                text: string;
                            }[];
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The frozen submissions, oldest first. Drive links withheld like the report. 404 report_not_found */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                v: number;
                                at: string;
                                by: string;
                                note: string;
                                snapshot: {
                                    summary: string;
                                    blockers: string;
                                    unplanned: {
                                        id: string;
                                        text: string;
                                        minutes: number;
                                    }[];
                                    extra: {
                                        [key: string]: string;
                                    };
                                    attachmentFileIds: string[];
                                    items: {
                                        ref: string;
                                        taskId: string | null;
                                        title: string;
                                        status: string;
                                        minutes: number;
                                        note: string;
                                        /** @enum {string} */
                                        outcome: "applied" | "needs_evidence" | "submitted_for_review" | "skipped_archived" | "skipped_unavailable";
                                    }[];
                                };
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports/{id}/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        mime: string;
                        sizeBytes: number;
                    };
                };
            };
            responses: {
                /** @description A presigned PUT (300 s), purpose report_attachment, owner only, at most 5 per report. 403 forbidden; 404 report_not_found; 409 report_locked; 422 mime_not_allowed | file_too_large | invalid_name | attachment_limit */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            fileId: string;
                            upload: {
                                /** @enum {string} */
                                method: "PUT";
                                url: string;
                                headers: {
                                    [key: string]: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports/{id}/uploads/{fileId}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    fileId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Upload confirmed; the malware scan is queued. Idempotent. 404 report_not_found | report_file_not_found; 409 upload_missing; 422 upload_mismatch */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            mime: string;
                            sizeBytes: number;
                            /** @enum {string} */
                            status: "pending" | "clean" | "infected" | "deleted";
                            signature: string | null;
                            sha256: string | null;
                            ownerUserId: string | null;
                            createdAt: string;
                            scannedAt: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/shift-reports/{id}/files/{fileId}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                    fileId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Redirect to a 60 s presigned GET after the scan gate. Never for an API key or a support session. 404 report_not_found | report_file_not_found; 409 file_not_ready; 410 file_infected */
                302: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/report-exports": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        format: "pdf" | "xlsx" | "csv";
                        /** Format: uuid */
                        reportId?: string;
                        from?: string;
                        to?: string;
                        /** Format: uuid */
                        team?: string;
                        person?: string;
                        /** @enum {string} */
                        status?: "all" | "draft" | "submitted" | "late" | "missing" | "accepted" | "returned";
                    };
                };
            };
            responses: {
                /** @description Queued: PDF, Excel or CSV of ONE report (`reportId`, in the caller's scope) or of a range (`from`/`to`, at most 92 days, default the last 7 days; `team`, `person`, `status` as in the inbox, rows equal the inbox rows), written to Files by a job and kept 7 days. A person only: an API key gets 403 api_key_forbidden_route. Every cap is checked first: 422 range_too_long | invalid_range | export_too_large (over 5000 reports or 50000 task rows) | pdf_too_large (over 500 reports) ; 404 report_not_found; 409 export_limit (3 active per requester); 403 api_key_forbidden_route (an API key) | forbidden */
                202: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/report-exports/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The requester's export: queued | running | done | failed | expired (done and the 7 days are over, derived; `errorCode` when failed, `forbidden` when the requester's access was reduced before it ran), the report count and when the file expires. Anybody else, in the same tenant or another: 404 report_export_not_found */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** Format: uuid */
                            id: string;
                            /** @enum {string} */
                            status: "queued" | "running" | "done" | "failed" | "expired";
                            /** @enum {string} */
                            format: "pdf" | "xlsx" | "csv";
                            rowCount: number | null;
                            expiresAt: string | null;
                            errorCode: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/report-exports/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Redirect to a 60 s presigned GET of the file. The requester only, and only while their CURRENT report scope is at least as wide as the one the export was made with (404 report_export_not_found for anybody else or after a demotion; an API key gets 403 api_key_forbidden_route and a support session 403 support_forbidden_route); 409 export_not_ready; 404 once the 7 days are over */
                302: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/dashboard": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The manager home bundle for the caller's scope (D5 tasks, F5 reports): summary (open, overdue, due today, completed today with a 7-day trend, awaiting review, evidence pending), tasks closed per tenant-local day (count, late, top closer), the status mix, the report deadline card (the caller's own next report; per-team counts for a manager) and the attention count (null without attention access). Cached 30 s per tenant and scope; never for a support session */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            asOf: string;
                            day: string;
                            summary: {
                                open: number;
                                overdue: number;
                                dueToday: number;
                                completedToday: number;
                                trend: number[];
                                awaitingReview: number;
                                evidencePending: number;
                            };
                            tasksClosed: {
                                days: {
                                    date: string;
                                    count: number;
                                    late: number;
                                    topCloser: {
                                        userId: string;
                                        name: string;
                                        count: number;
                                    } | null;
                                }[];
                            };
                            progress: {
                                total: number;
                                percent: number;
                                mix: {
                                    not_started: number;
                                    in_progress: number;
                                    blocked: number;
                                    submitted: number;
                                    changes_requested: number;
                                    completed: number;
                                    cancelled: number;
                                };
                            };
                            reportDeadline: {
                                member: {
                                    key: string;
                                    shiftName: string;
                                    shiftDate: string;
                                    startAt: string;
                                    endAt: string;
                                    dueAt: string;
                                    state: string;
                                    reportId: string | null;
                                } | null;
                                team: {
                                    open: number;
                                    missing: number;
                                    awaitingReview: number;
                                    nextDueAt: string | null;
                                    teams: {
                                        teamId: string;
                                        team: string;
                                        open: number;
                                        missing: number;
                                        nextDueAt: string | null;
                                    }[];
                                } | null;
                            };
                            attentionCount: number | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/dashboard/team-tasks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Open tasks in the caller's scope, due first (the task list's own `status=open` order): the home table. Cursor paged (`limit` 1-100, 400 invalid_cursor) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                ref: string;
                                title: string;
                                assigneeId: string;
                                assignee: string;
                                dept: string;
                                priority: number;
                                dueAt: string;
                                due: string;
                                late: boolean;
                                /** @enum {string} */
                                status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/dashboard/staff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The caller's OWN home (an API key: its creator's): my tasks (open, overdue, waiting for review, returned) and the open list, evidence waiting and returned with the reviewer's reason, the latest comments by others on my tasks, my next report. Personal: cached per user. 403 for a support session */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            myTasks: {
                                open: number;
                                overdue: number;
                                review: number;
                                returned: number;
                                items: {
                                    /** Format: uuid */
                                    id: string;
                                    ref: string;
                                    title: string;
                                    priority: number;
                                    /** @enum {string} */
                                    status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                                    dueAt: string;
                                    due: string;
                                    late: boolean;
                                }[];
                            };
                            evidence: {
                                awaitingReview: number;
                                returned: {
                                    ref: string;
                                    title: string;
                                    reason: string;
                                }[];
                            };
                            comments: {
                                /** Format: uuid */
                                id: string;
                                /** Format: uuid */
                                taskId: string;
                                ref: string;
                                taskTitle: string;
                                authorId: string | null;
                                author: string;
                                text: string;
                                at: string;
                            }[];
                            reportDeadline: {
                                member: {
                                    key: string;
                                    shiftName: string;
                                    shiftDate: string;
                                    startAt: string;
                                    endAt: string;
                                    dueAt: string;
                                    state: string;
                                    reportId: string | null;
                                } | null;
                                team: {
                                    open: number;
                                    missing: number;
                                    awaitingReview: number;
                                    nextDueAt: string | null;
                                    teams: {
                                        teamId: string;
                                        team: string;
                                        open: number;
                                        missing: number;
                                        nextDueAt: string | null;
                                    }[];
                                } | null;
                            };
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/attention": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description FR-M1-79 feed, derived from tasks and reports in the caller's scope (nothing is stored): overdue, blocked, evidence awaiting review, reports missing and returned (last 7 days), in that order, then due time. One entry per task. `total` counts every item; each kind is capped at 200 (100 for reports). Cursor paged */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** @enum {string} */
                                kind: "overdue" | "blocked" | "evidence_review" | "report_missing" | "report_returned";
                                ref: string | null;
                                taskId: string | null;
                                reportId: string | null;
                                reportKey: string | null;
                                title: string;
                                ownerId: string | null;
                                owner: string;
                                dueAt: string;
                                reason: string;
                            }[];
                            total: number;
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/today": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    mode?: "all" | "high-and-overdue";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The Today card (FR-M1-70..80): numbers only in `counts` (safe for a lock screen), the working day start, the day's order (`mode` all | high-and-overdue), the written summary, the manager's team line (reviewers only) and the member's returned plus missing reports. Cached 30 s per user. 403 for a support session */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            counts: {
                                overdue: number;
                                dueToday: number;
                                high: number;
                                review: number;
                                reports: number;
                                blocked: number;
                            };
                            workingDay: {
                                key: string;
                                startsAt: string;
                                hasShift: boolean;
                            };
                            order: {
                                /** Format: uuid */
                                taskId: string;
                                ref: string;
                                title: string;
                                priority: number;
                                status: string;
                                dueAt: string;
                                due: string;
                                evidenceRequired: boolean;
                                project: string;
                                /** @enum {string} */
                                group: "overdue" | "high-today" | "today";
                                reason: string;
                            }[];
                            summary: {
                                headline: string;
                                lines: {
                                    ref: string | null;
                                    text: string;
                                }[];
                                spoken: string;
                            };
                            team?: {
                                count: number;
                                items: {
                                    ref: string;
                                    title: string;
                                    who: string;
                                    reason: string;
                                }[];
                            };
                            reports: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/today/updates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** Format: uuid */
                        taskId: string;
                        /** @enum {string} */
                        action: "done" | "snooze";
                        dayKey: string;
                    };
                };
            };
            responses: {
                /** @description Mark done or snooze from the Today card: one id per person, task, action and working day, so a repeat is `duplicate` and writes nothing (an 'evidence still needed' result does not count: a later done completes the task). 422 invalid_day_key unless `dayKey` is today's working day in the tenant timezone. A Required task without clean evidence stays open (`evidenceStillNeeded`). Snooze writes one history line. 403 human_required (an API key marking done); 404 task_not_found (unknown, another tenant's, archived or out of scope) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            result: "applied" | "duplicate" | "skipped_archived";
                            /** @enum {string} */
                            status: "not_started" | "in_progress" | "blocked" | "submitted" | "changes_requested" | "completed" | "cancelled";
                            evidenceStillNeeded: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/mfa": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Whether the caller has 2FA and whether this session passed it */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            enrolled: boolean;
                            passed: boolean;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/mfa-policy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The tenant's MFA policy */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            mode: string;
                            roles: string[];
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        mode: string;
                        /** @default [] */
                        roles?: string[];
                    };
                };
            };
            responses: {
                /** @description The stored policy */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            mode: string;
                            roles: string[];
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    entity?: string;
                    /** @description Only this member's entries (the opaque member id, as `actorId` on a row). An unknown id is an empty page */
                    actorId?: string;
                    /** @description Exact action, for example `role.updated`. Not with actionPrefix (400 invalid_filter) */
                    action?: string;
                    /** @description Actions starting with this text, literally (`task.` for every task action). Not with action (400 invalid_filter) */
                    actionPrefix?: string;
                    /** @description Entries at or after this instant */
                    from?: string;
                    /** @description Entries at or before this instant; before `from` is 400 invalid_range */
                    to?: string;
                    limit?: number;
                    /** @description The `nextCursor` of the previous page. Anything else is 400 invalid_cursor (also another tenant's cursor) */
                    cursor?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description One page of audit entries in chain order, newest (highest seq) first, filtered by actor, action (exact or prefix), entity and time range. 400 invalid_filter (action with actionPrefix) | invalid_range (to before from) | invalid_cursor; limit 1 to 100, default 50. A read: the chain is never touched */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                seq: number;
                                at: string;
                                actorId: string | null;
                                action: string;
                                entity: string;
                                entityId: string;
                                before?: unknown;
                                after?: unknown;
                                hash: string;
                            }[];
                            /**
                             * @description Pass as `cursor` for the next (older) page; null on the last page
                             * @example MjAyNi0xMS0wMVQwMDowNTowMC4wMDBafDAxOTNiNmQ0LTAwMDAtNzAwMC04MDAwLTAwMDAwMDAwMDAwMQ
                             */
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/audit/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    entity?: string;
                    /** @description Only this member's entries (the opaque member id, as `actorId` on a row). An unknown id is an empty page */
                    actorId?: string;
                    /** @description Exact action, for example `role.updated`. Not with actionPrefix (400 invalid_filter) */
                    action?: string;
                    /** @description Actions starting with this text, literally (`task.` for every task action). Not with action (400 invalid_filter) */
                    actionPrefix?: string;
                    /** @description Entries at or after this instant */
                    from?: string;
                    /** @description Entries at or before this instant; before `from` is 400 invalid_range */
                    to?: string;
                    format: "csv";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Every matching entry as CSV (streamed), same filters as the list (not paged). 400 invalid_filter | invalid_range */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/csv": string;
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/devices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description All devices of the tenant for settings:write, otherwise only the caller's own */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            userId: string;
                            /** @enum {string} */
                            type: "pc" | "android" | "browser";
                            /** @enum {string} */
                            owner: "company" | "personal";
                            label: string;
                            trusted: boolean;
                            lastSeen: string | null;
                        }[];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        userId: string;
                        /** @enum {string} */
                        type: "pc" | "android" | "browser";
                        /** @enum {string} */
                        owner: "company" | "personal";
                        label: string;
                        /** @default false */
                        trusted?: boolean;
                    };
                };
            };
            responses: {
                /** @description Registered device */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            userId: string;
                            /** @enum {string} */
                            type: "pc" | "android" | "browser";
                            /** @enum {string} */
                            owner: "company" | "personal";
                            label: string;
                            trusted: boolean;
                            lastSeen: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/devices/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Retired: the device and its binding are removed (audited device.retired); a browser that was bound to it is the unregistered browser from its next request. 404 device_not_found (also another tenant's id). Open to a read-only (blocked) tenant. */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        type?: "pc" | "android" | "browser";
                        /** @enum {string} */
                        owner?: "company" | "personal";
                        label?: string;
                        trusted?: boolean;
                    };
                };
            };
            responses: {
                /** @description Updated device (takes effect on the device's next request) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            userId: string;
                            /** @enum {string} */
                            type: "pc" | "android" | "browser";
                            /** @enum {string} */
                            owner: "company" | "personal";
                            label: string;
                            trusted: boolean;
                            lastSeen: string | null;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/devices/{id}/enrolment-code": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description One-time enrolment code (shown once, valid 15 minutes); also resets the device's current binding */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            code: string;
                            expiresAt: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/devices/{id}/bind": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: {
                content: {
                    "application/json": {
                        code?: string;
                    };
                };
            };
            responses: {
                /** @description Device bound to this browser (signed HttpOnly per-tenant od-device cookie) with a valid one-time enrolment code; only the allocated user, only while unbound (409 device_already_bound), wrong/expired code 422 invalid_enrolment_code */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            userId: string;
                            /** @enum {string} */
                            type: "pc" | "android" | "browser";
                            /** @enum {string} */
                            owner: "company" | "personal";
                            label: string;
                            trusted: boolean;
                            lastSeen: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/device-policies": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Effective policy per feature (no stored row = any) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            feature: "drive" | "payroll";
                            /** @enum {string} */
                            allow: "trusted-company-pc" | "any" | "none";
                        }[];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/device-policies/{feature}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    feature: "drive" | "payroll";
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        allow: "trusted-company-pc" | "any" | "none";
                    };
                };
            };
            responses: {
                /** @description The policy now in force */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            feature: "drive" | "payroll";
                            /** @enum {string} */
                            allow: "trusted-company-pc" | "any" | "none";
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    unread?: "true" | "false";
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The caller's own in-app notifications, newest first, with their unread count */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string;
                                /** @enum {string} */
                                kind: "invite" | "member" | "file" | "security" | "dsr" | "billing" | "system" | "task" | "report";
                                title: string;
                                body: string;
                                link: string | null;
                                createdAt: string;
                                readAt: string | null;
                            }[];
                            unread: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notifications/read-all": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Marks all of the caller's notifications read */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            updated: number;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/notifications/{id}/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The notification, marked read. Another user's or tenant's id is 404 notification_not_found */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            /** @enum {string} */
                            kind: "invite" | "member" | "file" | "security" | "dsr" | "billing" | "system" | "task" | "report";
                            title: string;
                            body: string;
                            link: string | null;
                            createdAt: string;
                            readAt: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/notification-preferences": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Effective channel matrix per kind plus quiet hours (tenant-local HH:MM) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            channels: {
                                invite?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                member?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                file?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                security?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                dsr?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                billing?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                system?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                task?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                report?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                            };
                            quietStart: string | null;
                            quietEnd: string | null;
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        channels: {
                            invite?: {
                                inApp?: boolean;
                                email?: boolean;
                                push?: boolean;
                            };
                            member?: {
                                inApp?: boolean;
                                email?: boolean;
                                push?: boolean;
                            };
                            file?: {
                                inApp?: boolean;
                                email?: boolean;
                                push?: boolean;
                            };
                            security?: {
                                inApp?: boolean;
                                email?: boolean;
                                push?: boolean;
                            };
                            dsr?: {
                                inApp?: boolean;
                                email?: boolean;
                                push?: boolean;
                            };
                            billing?: {
                                inApp?: boolean;
                                email?: boolean;
                                push?: boolean;
                            };
                            system?: {
                                inApp?: boolean;
                                email?: boolean;
                                push?: boolean;
                            };
                            task?: {
                                inApp?: boolean;
                                email?: boolean;
                                push?: boolean;
                            };
                            report?: {
                                inApp?: boolean;
                                email?: boolean;
                                push?: boolean;
                            };
                        };
                        quietStart: string | null;
                        quietEnd: string | null;
                    };
                };
            };
            responses: {
                /** @description Saved. Quiet hours: both null or both HH:MM and different, else 422 invalid_quiet_hours. security always keeps in-app and email */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            channels: {
                                invite?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                member?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                file?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                security?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                dsr?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                billing?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                system?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                task?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                                report?: {
                                    inApp: boolean;
                                    email: boolean;
                                    push: boolean;
                                };
                            };
                            quietStart: string | null;
                            quietEnd: string | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/push-tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        token: string;
                        /**
                         * @default android
                         * @enum {string}
                         */
                        platform?: "android";
                    };
                };
            };
            responses: {
                /** @description Token stored sealed; the raw token is never returned. Re-registering the same token returns the same id */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            /** @enum {string} */
                            platform: "android";
                            createdAt: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/push-tokens/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Removed. Another user's or tenant's id is 404 push_token_not_found */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/files/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name: string;
                        mime: string;
                        sizeBytes: number;
                    };
                };
            };
            responses: {
                /** @description A presigned PUT (300 s) to a staging key; Content-Type and Content-Length are signed, send exactly `headers`. 422 mime_not_allowed, invalid_name or file_too_large; 503 storage_not_configured */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            fileId: string;
                            upload: {
                                /** @enum {string} */
                                method: "PUT";
                                url: string;
                                headers: {
                                    [key: string]: string;
                                };
                            };
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/files/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Upload confirmed; status stays pending until the malware scan finishes. 422 upload_mismatch, 409 upload_missing. Idempotent */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            mime: string;
                            sizeBytes: number;
                            /** @enum {string} */
                            status: "pending" | "clean" | "infected" | "deleted";
                            signature: string | null;
                            sha256: string | null;
                            ownerUserId: string | null;
                            createdAt: string;
                            scannedAt: string | null;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/files/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description File metadata (never the storage key); needs files:read, except a DSR export which only its requester and settings:write may open. Another tenant's or a deleted id is 404 file_not_found */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            mime: string;
                            sizeBytes: number;
                            /** @enum {string} */
                            status: "pending" | "clean" | "infected" | "deleted";
                            signature: string | null;
                            sha256: string | null;
                            ownerUserId: string | null;
                            createdAt: string;
                            scannedAt: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Soft-deleted and audited; the stored object is removed by a background job */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/files/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Redirect to a 60 s presigned GET (attachment). 409 file_not_ready until clean, 410 file_infected */
                302: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/organisation": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Organisation settings; reportDeadline falls back to the onboarding default */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            name: string;
                            slug: string;
                            timezone: string;
                            currency: string;
                            locale: string;
                            reportDeadline: string;
                            reportDueAfterMinutes: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        name?: string;
                        timezone?: string;
                        currency?: string;
                        locale?: string;
                        reportDeadline?: string;
                        reportDueAfterMinutes?: number;
                    };
                };
            };
            responses: {
                /** @description Updated settings. 422 invalid_name | invalid_timezone | invalid_locale | invalid_currency | invalid_report_deadline | invalid_report_due (minutes after a shift ends, 0-1440). Audited with before/after */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            name: string;
                            slug: string;
                            timezone: string;
                            currency: string;
                            locale: string;
                            reportDeadline: string;
                            reportDueAfterMinutes: number;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/settings/branding": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Branding */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            logoFileId: string | null;
                            primaryColor: string | null;
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        logoFileId: string | null;
                        primaryColor: string | null;
                    };
                };
            };
            responses: {
                /** @description Replaced branding. 422 invalid_logo (not a clean file of this tenant) | invalid_color (#RRGGBB) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            logoFileId: string | null;
                            primaryColor: string | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/holidays": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    year?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Holidays of the year (default: the current year in the tenant's timezone), by date */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            year: number;
                            holidays: {
                                date: string;
                                name: string;
                            }[];
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        year: number;
                        holidays: {
                            date: string;
                            name: string;
                        }[];
                    };
                };
            };
            responses: {
                /** @description The year's set is replaced. 422 invalid_holiday_date | holiday_out_of_year | duplicate_holiday_date | invalid_holiday_name */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            year: number;
                            holidays: {
                                date: string;
                                name: string;
                            }[];
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/integrations": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The tenant's integration connections. Tokens are never returned */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            provider: string;
                            status: string;
                            scopes: string[];
                            accountEmail: string | null;
                            connectedBy: string;
                            connectedAt: string;
                            lastRefreshAt: string | null;
                        }[];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/integrations/google/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The Google consent URL (PKCE S256 + single-use state, valid 10 minutes). 503 integration_not_configured */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            url: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/integrations/google/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    code?: string;
                    state?: string;
                    error?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Redirect to APP_URL/settings/integrations?status=connected|error[&reason=<short code>]; no code or token is ever echoed. Must be called by the user who started. 400 invalid_oauth_state (unknown, expired, reused, or another user's state) */
                302: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/integrations/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Revoked at Google (best effort), marked revoked and its tokens erased; idempotent. Another tenant's id is 404 integration_not_found */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    q?: string;
                    limit?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Hits among the modules the caller can read, best first. q is 2..100 chars after trim else 422 invalid_query; limit defaults to 10 and is clamped to 1..20 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            hits: {
                                entity: string;
                                entityId: string;
                                title: string;
                                module: string;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/data-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    status?: "pending" | "running" | "completed" | "rejected" | "failed";
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Overdue open requests first (earliest due first), then other open ones, then finished ones */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DataRequest"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        subjectUserId: string;
                        /** @enum {string} */
                        kind: "export" | "correct" | "erase";
                        reason: string;
                    };
                };
            };
            responses: {
                /** @description Request opened; due 30 days later in tenant time. Export/erase run as background jobs. 404 member_not_found, 409 last_owner|request_open, 422 self_request_not_allowed (erase/correct of yourself) */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DataRequest"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/data-requests/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description One request. Another tenant's or unknown id is 404 data_request_not_found */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DataRequest"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/data-requests/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        notes?: string;
                    };
                };
            };
            responses: {
                /** @description A pending `correct` request closed after the data was edited by hand. 409 not_a_correction|request_closed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DataRequest"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/data-requests/{id}/reject": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        notes: string;
                    };
                };
            };
            responses: {
                /** @description A pending or failed request turned down; the reason is stored in notes. 409 request_closed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DataRequest"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/data-requests/{id}/retry": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description A failed export/erase put back to pending and queued again (audited dsr.retried). 409 request_not_failed */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DataRequest"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/me/data-export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The caller's own export requests (status, due date, result file id), newest open first */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DataRequest"][];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Self-service: opens an export request for the caller (any active member). The requester downloads the finished file from /v1/files/{resultFileId}/download. 409 request_open */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DataRequest"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Cheap console probe: the caller is active staff and this session passed its second factor. One indexed staff lookup, no tenant query. 401 mfa_challenge | mfa_enrolment_required, 404 not_found for everyone who is not active staff */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            staff: true;
                            /** @enum {string} */
                            role: "owner" | "support" | "billing" | "viewer";
                            /** @enum {string} */
                            mfa: "ok";
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/staff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Platform staff */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            userId: string;
                            name: string;
                            email: string;
                            /** @enum {string} */
                            role: "owner" | "support" | "billing" | "viewer";
                            /** @enum {string} */
                            status: "active" | "suspended";
                            twoFactorEnabled: boolean;
                            addedBy: string;
                            addedAt: string;
                        }[];
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        email: string;
                        /** @enum {string} */
                        role: "owner" | "support" | "billing" | "viewer";
                    };
                };
            };
            responses: {
                /** @description Added (an existing, non-erased user; 2FA is enforced at every request, not here) */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            userId: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/staff/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    userId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /** @enum {string} */
                        role?: "owner" | "support" | "billing" | "viewer";
                        /** @enum {string} */
                        status?: "active" | "suspended";
                    };
                };
            };
            responses: {
                /** @description Updated; the last active owner cannot be demoted or suspended (409 last_platform_owner) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/platform/audit": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    entity?: string;
                    targetTenantId?: string;
                    from?: string;
                    to?: string;
                    limit?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Platform audit entries, newest first */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            seq: number;
                            at: string;
                            actorId: string;
                            action: string;
                            entity: string;
                            entityId: string;
                            targetTenantId: string | null;
                            before?: unknown;
                            after?: unknown;
                            hash: string;
                        }[];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/audit/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query: {
                    entity?: string;
                    targetTenantId?: string;
                    from?: string;
                    to?: string;
                    format: "csv";
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Every matching entry as CSV (streamed) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/csv": string;
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/tenants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    q?: string;
                    status?: string;
                    plan?: string;
                    page?: number;
                    pageSize?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Tenants with plan and subscription status (page of `pageSize`, newest first). Metadata only. 422 invalid_status | invalid_plan */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string;
                                slug: string;
                                name: string;
                                status: string;
                                createdAt: string;
                                planId: string | null;
                                subscriptionStatus: string | null;
                                seats: number | null;
                            }[];
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/tenants/{tenantId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    tenantId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Tenant 360: aggregates only, never member names or emails. 404 tenant_not_found. */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            tenant: {
                                id: string;
                                slug: string;
                                name: string;
                                status: string;
                                timezone: string;
                                currency: string;
                                locale: string;
                                createdAt: string;
                            };
                            subscription: {
                                planId: string;
                                status: string;
                                seats: number;
                                trialEndsAt: string | null;
                                currentPeriodEnd: string | null;
                                cancelAtPeriodEnd: boolean;
                                hasProviderSubscription: boolean;
                            } | null;
                            seatsUsed: number;
                            memberCount: number;
                            moduleOverrides: {
                                module: string;
                                /** @enum {string} */
                                mode: "grant" | "revoke";
                                reason: string;
                                setAt: string;
                            }[];
                            /** @description Date (YYYY-MM-DD, UTC) of the newest tenant audit event; no detail */
                            lastActivityDate: string | null;
                            openDataRequests: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/tenants/{tenantId}/suspend": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    tenantId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description Required: 1..500 characters (422 invalid_reason otherwise)
                         * @example Payment overdue 30 days
                         */
                        reason?: unknown;
                    };
                };
            };
            responses: {
                /** @description Suspended (members get 404; data kept). Audited in the tenant chain (actor platform:<staffId>) and the platform chain. 404 tenant_not_found. 409 already_suspended, 422 invalid_reason */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "active" | "suspended";
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/tenants/{tenantId}/reactivate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    tenantId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description Required: 1..500 characters (422 invalid_reason otherwise)
                         * @example Payment overdue 30 days
                         */
                        reason?: unknown;
                    };
                };
            };
            responses: {
                /** @description Reactivated. 404 tenant_not_found. 409 not_suspended, 422 invalid_reason */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {string} */
                            status: "active" | "suspended";
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/tenants/{tenantId}/extend-trial": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    tenantId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description Integer 1..30 (422 invalid_days otherwise)
                         * @example 7
                         */
                        days?: unknown;
                        /**
                         * @description Required: 1..500 characters (422 invalid_reason otherwise)
                         * @example Payment overdue 30 days
                         */
                        reason?: unknown;
                    };
                };
            };
            responses: {
                /** @description New trial end = max(now, trial end) + days. 404 tenant_not_found. 422 invalid_days | invalid_reason | not_trialing */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            trialEndsAt: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/tenants/{tenantId}/modules": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    tenantId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        overrides: {
                            module: string;
                            /** @enum {string} */
                            mode: "grant" | "revoke";
                        }[];
                        /**
                         * @description Required: 1..500 characters (422 invalid_reason otherwise)
                         * @example Payment overdue 30 days
                         */
                        reason?: unknown;
                    };
                };
            };
            responses: {
                /** @description Replaces the tenant's module overrides (unlisted ones are cleared); effective within 60 s. 404 tenant_not_found. 422 unknown_module | core_module | duplicate_module | invalid_reason */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            overrides: {
                                module: string;
                                /** @enum {string} */
                                mode: "grant" | "revoke";
                            }[];
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/metrics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description MRR/ARR per currency in minor units (ACTIVE subscriptions only, ruling C11), trials, past_due (reported as its own count, not in MRR), churn (moved to canceled in the last 30 days) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            mrrMinor: {
                                [key: string]: number;
                            };
                            arrMinor: {
                                [key: string]: number;
                            };
                            trials: number;
                            pastDue: number;
                            churnLast30Days: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/data-requests": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    page?: number;
                    pageSize?: number;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description GDPR requests across tenants, overdue first then due date ascending. No subject identity */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string;
                                tenantId: string;
                                tenantName: string;
                                kind: string;
                                status: string;
                                createdAt: string;
                                dueAt: string;
                                overdue: boolean;
                            }[];
                            page: number;
                            pageSize: number;
                            total: number;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/tenants/{tenantId}/support-grants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    tenantId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description Required: 1..500 characters (422 invalid_reason otherwise)
                         * @example Ticket 4411: report totals look wrong
                         */
                        reason?: unknown;
                        /**
                         * @description Integer 1..24 (422 invalid_hours otherwise)
                         * @example 2
                         */
                        hours?: unknown;
                    };
                };
            };
            responses: {
                /** @description Read-only support access to the tenant FOR THE CALLER, from now for `hours`. Tenant owners are notified at once. Audited in both chains. 404 tenant_not_found (also suspended), 409 grant_exists, 422 invalid_reason | invalid_hours */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            tenantId: string;
                            staffUserId: string;
                            reason: string;
                            grantedBy: string;
                            startsAt: string;
                            expiresAt: string;
                            revokedAt: string | null;
                            /** @enum {string} */
                            status: "active" | "expired" | "revoked";
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/support-grants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    tenantId?: string;
                    status?: "active" | "expired" | "revoked";
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Support grants across tenants (or one tenant), newest first by start time then id, keyset `cursor` (400 invalid_cursor), at most `limit` (default 50, max 100). Every platform role may read; scope is always read_only; no secret exists on a grant. A read: no audit row, an info log line. 404 tenant_not_found for an unknown `tenantId` */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string;
                                tenantId: string;
                                tenantName: string;
                                grantedBy: string;
                                staffName: string | null;
                                /** @enum {string} */
                                scope: "read_only";
                                /** @description Null for the viewer and billing roles (least privilege) */
                                reason: string | null;
                                /** @enum {string} */
                                status: "active" | "expired" | "revoked";
                                /** @description True when the caller may revoke it now: active, and the caller is the platform owner or the grantee */
                                canRevoke: boolean;
                                createdAt: string;
                                expiresAt: string;
                                revokedAt: string | null;
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/support-grants/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Revoked (platform owner: any grant; otherwise only the grantee's own: 403 platform_forbidden). 404 grant_not_found, 409 grant_inactive */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            tenantId: string;
                            staffUserId: string;
                            reason: string;
                            grantedBy: string;
                            startsAt: string;
                            expiresAt: string;
                            revokedAt: string | null;
                            /** @enum {string} */
                            status: "active" | "expired" | "revoked";
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/support-grants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The tenant's support grants (newest first, at most 200) with the staff display name (owner or admin) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string;
                                tenantId: string;
                                staffUserId: string;
                                reason: string;
                                grantedBy: string;
                                startsAt: string;
                                expiresAt: string;
                                revokedAt: string | null;
                                /** @enum {string} */
                                status: "active" | "expired" | "revoked";
                                staffName: string | null;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/settings/support-grants/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Revoked by a tenant owner; support loses access on its next request. Audited in both chains. 404 grant_not_found, 409 grant_inactive */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            tenantId: string;
                            staffUserId: string;
                            reason: string;
                            grantedBy: string;
                            startsAt: string;
                            expiresAt: string;
                            revokedAt: string | null;
                            /** @enum {string} */
                            status: "active" | "expired" | "revoked";
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/api-keys": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The tenant's keys, newest first (never the key or its hash) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string;
                                name: string;
                                prefix: string;
                                scopes: string[];
                                createdBy: string;
                                createdAt: string;
                                lastUsedAt: string | null;
                                revokedAt: string | null;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description 1..100 characters
                         * @example CI export
                         */
                        name?: unknown;
                        /**
                         * @description `<module>:read|write`, each a subset of the creator's current role
                         * @example [
                         *       "tasks:read",
                         *       "settings:write"
                         *     ]
                         */
                        scopes?: unknown;
                    };
                };
            };
            responses: {
                /** @description The key, shown ONCE (`odk_<prefix>_<secret>`; only its sha256 is stored). Audited. 422 invalid_name | invalid_scope | scope_exceeds_role */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            prefix: string;
                            scopes: string[];
                            createdBy: string;
                            createdAt: string;
                            lastUsedAt: string | null;
                            revokedAt: string | null;
                            key: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/api-keys/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Revoked: the key answers 401 invalid_api_key from now on. 404 api_key_not_found, 409 api_key_revoked */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            name: string;
                            prefix: string;
                            scopes: string[];
                            createdBy: string;
                            createdAt: string;
                            lastUsedAt: string | null;
                            revokedAt: string | null;
                        };
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/webhooks": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The tenant's endpoints (never the secret) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                id: string;
                                url: string;
                                events: string[];
                                active: boolean;
                                createdBy: string;
                                createdAt: string;
                                failingSince: string | null;
                            }[];
                        };
                    };
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        /**
                         * @description https only, at most 2048 characters, no userinfo, port 443 or 1024-65535, every resolved address public
                         * @example https://hooks.example.com/opsdesk
                         */
                        url?: unknown;
                        /**
                         * @description Subset of the allow-list of event types (see WEBHOOK_EVENT_TYPES)
                         * @example [
                         *       "team.created",
                         *       "file.uploaded"
                         *     ]
                         */
                        events?: unknown;
                    };
                };
            };
            responses: {
                /** @description The endpoint with its signing secret, shown ONCE. Deliveries carry `X-OpsDesk-Signature: t=<unix ts>,v1=<hex hmac_sha256(secret, "<ts>.<body>")>`. 409 webhook_limit (10 per tenant), 422 invalid_webhook_url | unsafe_webhook_url | invalid_events */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            url: string;
                            events: string[];
                            active: boolean;
                            createdBy: string;
                            createdAt: string;
                            failingSince: string | null;
                            secret: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/webhooks/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Deleted (the secret is destroyed). 404 webhook_not_found */
                204: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        url?: unknown;
                        events?: unknown;
                        active?: boolean;
                    };
                };
            };
            responses: {
                /** @description Updated endpoint (a changed URL is re-checked; `active: true` resumes a disabled endpoint). 404 webhook_not_found, 422 invalid_webhook_url | unsafe_webhook_url | invalid_events */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            id: string;
                            url: string;
                            events: string[];
                            active: boolean;
                            createdBy: string;
                            createdAt: string;
                            failingSince: string | null;
                        };
                    };
                };
            };
        };
        trace?: never;
    };
    "/v1/platform/settings/email": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Platform email settings; the key is never returned, only its last 4 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            configured: false;
                        } | {
                            /** @enum {boolean} */
                            configured: true;
                            /** @enum {string} */
                            provider: "resend";
                            fromAddress: string;
                            fromName: string;
                            keyLast4: string;
                            updatedAt: string;
                            updatedBy: string | null;
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        apiKey?: string;
                        fromAddress: string;
                        fromName: string;
                    };
                };
            };
            responses: {
                /** @description The stored settings (audited in the same transaction) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            configured: false;
                        } | {
                            /** @enum {boolean} */
                            configured: true;
                            /** @enum {string} */
                            provider: "resend";
                            fromAddress: string;
                            fromName: string;
                            keyLast4: string;
                            updatedAt: string;
                            updatedBy: string | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/settings/email/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        to: string;
                    };
                };
            };
            responses: {
                /** @description Result of a test send with the stored settings */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        } | {
                            /** @enum {boolean} */
                            ok: false;
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/settings/storage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Platform R2 storage settings; the secret is never returned, only its last 4 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            configured: false;
                        } | {
                            /** @enum {boolean} */
                            configured: true;
                            /** @enum {string} */
                            provider: "r2";
                            accountId: string;
                            bucket: string;
                            accessKeyId: string;
                            secretLast4: string;
                            updatedAt: string;
                            updatedBy: string | null;
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        accountId: string;
                        bucket: string;
                        accessKeyId: string;
                        secretAccessKey?: string;
                    };
                };
            };
            responses: {
                /** @description The stored settings (audited in the same transaction) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            configured: false;
                        } | {
                            /** @enum {boolean} */
                            configured: true;
                            /** @enum {string} */
                            provider: "r2";
                            accountId: string;
                            bucket: string;
                            accessKeyId: string;
                            secretLast4: string;
                            updatedAt: string;
                            updatedBy: string | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/settings/storage/test": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Result of a put+delete probe against the stored bucket */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            ok: true;
                        } | {
                            /** @enum {boolean} */
                            ok: false;
                            error: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/platform/settings/billing": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Platform billing settings; secrets are never returned, only their last 4 */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            configured: false;
                        } | {
                            /** @enum {boolean} */
                            configured: true;
                            /** @enum {string} */
                            provider: "stripe";
                            secretKeyLast4: string;
                            webhookSecretLast4: string;
                            publishableKey: string | null;
                            priceMap: {
                                [key: string]: string;
                            };
                            webhookUrl: string;
                            updatedAt: string;
                            updatedBy: string | null;
                        };
                    };
                };
            };
        };
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        secretKey?: string;
                        webhookSecret?: string;
                        publishableKey?: string | null;
                        priceMap?: {
                            [key: string]: string;
                        };
                    };
                };
            };
            responses: {
                /** @description The stored settings (audited in the same transaction) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            /** @enum {boolean} */
                            configured: false;
                        } | {
                            /** @enum {boolean} */
                            configured: true;
                            /** @enum {string} */
                            provider: "stripe";
                            secretKeyLast4: string;
                            webhookSecretLast4: string;
                            publishableKey: string | null;
                            priceMap: {
                                [key: string]: string;
                            };
                            webhookUrl: string;
                            updatedAt: string;
                            updatedBy: string | null;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/entitlements": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The tenant's plan, status, product modules and seats (any member; cached <= 60 s) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            planId: string;
                            /** @enum {string} */
                            status: "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "unpaid" | "paused";
                            /** @description Product module ids the tenant may use (plan plus overrides) */
                            modules: string[];
                            seats: number;
                            seatsUsed: number;
                            trialEndsAt: string | null;
                            /** @description Trial end + 7 days: writes are allowed until then, then billing_required (402) */
                            graceEndsAt: string | null;
                            /** @enum {string} */
                            billingState: "ok" | "grace" | "blocked";
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/billing/subscription": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description The tenant's subscription (owner or admin) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            planId: string;
                            planName: string;
                            priceMonthlyMinor: number;
                            currency: string;
                            /** @enum {string} */
                            status: "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "unpaid" | "paused";
                            seats: number;
                            seatsUsed: number;
                            trialEndsAt: string | null;
                            currentPeriodEnd: string | null;
                            cancelAtPeriodEnd: boolean;
                            /** @enum {string} */
                            billingState: "ok" | "grace" | "blocked";
                            graceEndsAt: string | null;
                            hasProviderSubscription: boolean;
                            hasCustomer: boolean;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/billing/invoices": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: {
                    limit?: number;
                    cursor?: string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Invoices, newest first; pass nextCursor back as cursor */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            items: {
                                /** Format: uuid */
                                id: string;
                                providerInvoiceId: string;
                                /** @description Integer minor units (cents) of `currency` */
                                amountMinor: number;
                                currency: string;
                                /** @enum {string} */
                                status: "paid" | "open" | "failed";
                                hostedUrl: string | null;
                                periodStart: string;
                                periodEnd: string;
                                createdAt: string;
                            }[];
                            nextCursor: string | null;
                        };
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/billing/checkout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        planId: string;
                    };
                };
            };
            responses: {
                /** @description Hosted checkout URL (success/cancel return to APP_URL/settings/billing) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            url: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/billing/portal": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Hosted billing portal URL */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            url: string;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/billing/cancel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Cancellation scheduled for the period end */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            planId: string;
                            planName: string;
                            priceMonthlyMinor: number;
                            currency: string;
                            /** @enum {string} */
                            status: "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "unpaid" | "paused";
                            seats: number;
                            seatsUsed: number;
                            trialEndsAt: string | null;
                            currentPeriodEnd: string | null;
                            cancelAtPeriodEnd: boolean;
                            /** @enum {string} */
                            billingState: "ok" | "grace" | "blocked";
                            graceEndsAt: string | null;
                            hasProviderSubscription: boolean;
                            hasCustomer: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/billing/resume": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description Scheduled cancellation withdrawn */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            planId: string;
                            planName: string;
                            priceMonthlyMinor: number;
                            currency: string;
                            /** @enum {string} */
                            status: "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "unpaid" | "paused";
                            seats: number;
                            seatsUsed: number;
                            trialEndsAt: string | null;
                            currentPeriodEnd: string | null;
                            cancelAtPeriodEnd: boolean;
                            /** @enum {string} */
                            billingState: "ok" | "grace" | "blocked";
                            graceEndsAt: string | null;
                            hasProviderSubscription: boolean;
                            hasCustomer: boolean;
                        };
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/billing/seats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/json": {
                        seats: number;
                    };
                };
            };
            responses: {
                /** @description Seats updated (never below the active members) */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": {
                            planId: string;
                            planName: string;
                            priceMonthlyMinor: number;
                            currency: string;
                            /** @enum {string} */
                            status: "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "unpaid" | "paused";
                            seats: number;
                            seatsUsed: number;
                            trialEndsAt: string | null;
                            currentPeriodEnd: string | null;
                            cancelAtPeriodEnd: boolean;
                            /** @enum {string} */
                            billingState: "ok" | "grace" | "blocked";
                            graceEndsAt: string | null;
                            hasProviderSubscription: boolean;
                            hasCustomer: boolean;
                        };
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /**
         * @example {
         *       "id": "5f1c1c5e-2d1b-4c51-9a1e-0f0e8f0e8f0e",
         *       "subjectUserId": "usr_123",
         *       "kind": "export",
         *       "status": "pending",
         *       "requestedBy": "usr_456",
         *       "reason": "Subject access request received by email",
         *       "createdAt": "2026-11-17T09:00:00.000Z",
         *       "dueAt": "2026-12-17T09:00:00.000Z",
         *       "overdue": false,
         *       "startedAt": null,
         *       "completedAt": null,
         *       "resultFileId": null,
         *       "errorCode": null,
         *       "notes": null
         *     }
         */
        DataRequest: {
            id: string;
            subjectUserId: string;
            /** @enum {string} */
            kind: "export" | "correct" | "erase";
            /** @enum {string} */
            status: "pending" | "running" | "completed" | "rejected" | "failed";
            requestedBy: string;
            reason: string;
            createdAt: string;
            dueAt: string;
            overdue: boolean;
            startedAt: string | null;
            completedAt: string | null;
            resultFileId: string | null;
            errorCode: string | null;
            notes: string | null;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
