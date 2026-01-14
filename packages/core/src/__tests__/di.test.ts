/**
 * DI Infrastructure Tests
 *
 * These tests demonstrate the recommended patterns for:
 * 1. Building containers with ContainerBuilder
 * 2. Testing with createTestContainer (no static mocks)
 * 3. Composing middleware chains
 * 4. Mapping domain errors to HTTP responses
 */

import { describe, it, expect, vi } from "vitest";
import {
  ContainerBuilder,
  createTestContainer,
  compose,
  createEndpoint,
  mapError,
} from "../infrastructure/di/index.js";
import {
  EntityNotFoundError,
  ValidationError,
  ConflictError,
  BusinessRuleError,
  AuthenticationError,
  AuthorizationError,
} from "../domain/errors.js";

// =============================================================================
// Test Types - Example service interfaces
// =============================================================================

interface IssueRepository {
  findById(id: string): Promise<{ id: string; title: string } | null>;
}

interface IssueService {
  getIssue(id: string): Promise<{ id: string; title: string }>;
}

interface TestCradle {
  issueRepository: IssueRepository;
  issueService: IssueService;
}

// =============================================================================
// Example Implementations
// =============================================================================

class InMemoryIssueRepository implements IssueRepository {
  private issues = new Map<string, { id: string; title: string }>();

  async findById(id: string) {
    return this.issues.get(id) ?? null;
  }

  // Helper for tests
  setIssue(id: string, title: string) {
    this.issues.set(id, { id, title });
  }
}

class DefaultIssueService implements IssueService {
  constructor(private readonly issueRepository: IssueRepository) {}

  async getIssue(id: string) {
    const issue = await this.issueRepository.findById(id);
    if (!issue) {
      throw new EntityNotFoundError("Issue", id);
    }
    return issue;
  }
}

// =============================================================================
// ContainerBuilder Tests
// =============================================================================

describe("ContainerBuilder", () => {
  it("should build a container with registered services", () => {
    const container = new ContainerBuilder<TestCradle>()
      .registerSingleton("issueRepository", InMemoryIssueRepository)
      .registerScoped("issueService", DefaultIssueService)
      .build();

    expect(container.cradle.issueService).toBeInstanceOf(DefaultIssueService);
    expect(container.cradle.issueRepository).toBeInstanceOf(InMemoryIssueRepository);
  });

  it("should resolve singleton dependencies once", () => {
    const container = new ContainerBuilder<TestCradle>()
      .registerSingleton("issueRepository", InMemoryIssueRepository)
      .registerScoped("issueService", DefaultIssueService)
      .build();

    const repo1 = container.cradle.issueRepository;
    const repo2 = container.cradle.issueRepository;
    expect(repo1).toBe(repo2);
  });

  it("should support factory registration", () => {
    const mockRepo = { findById: vi.fn() };

    const container = new ContainerBuilder<TestCradle>()
      .registerFactory("issueRepository", () => mockRepo as IssueRepository)
      .registerScoped("issueService", DefaultIssueService)
      .build();

    expect(container.cradle.issueRepository).toBe(mockRepo);
  });

  it("should support value registration", () => {
    const config = { id: "test", title: "Test Issue" };

    interface ConfigCradle {
      config: { id: string; title: string };
    }

    const container = new ContainerBuilder<ConfigCradle>().registerValue("config", config).build();

    expect(container.cradle.config).toBe(config);
  });
});

// =============================================================================
// Test Container Pattern Tests
// =============================================================================

describe("createTestContainer", () => {
  it("should clone production container and allow mock replacement", async () => {
    // 1. Build the "production" container
    const prodContainer = new ContainerBuilder<TestCradle>()
      .registerSingleton("issueRepository", InMemoryIssueRepository)
      .registerScoped("issueService", DefaultIssueService)
      .build();

    // 2. Create mock repository
    const mockRepo: IssueRepository = {
      findById: vi.fn().mockResolvedValue({ id: "123", title: "Mocked Issue" }),
    };

    // 3. Create test container with mock
    const testContainer = createTestContainer(prodContainer, {
      issueRepository: () => mockRepo,
    });

    // 4. Service uses mocked repository
    const issue = await testContainer.cradle.issueService.getIssue("123");
    expect(issue.title).toBe("Mocked Issue");
    expect(mockRepo.findById).toHaveBeenCalledWith("123");
  });

  it("should preserve non-overridden registrations", async () => {
    const prodContainer = new ContainerBuilder<TestCradle>()
      .registerSingleton("issueRepository", InMemoryIssueRepository)
      .registerScoped("issueService", DefaultIssueService)
      .build();

    // Only override issueRepository
    const mockRepo: IssueRepository = {
      findById: vi.fn().mockResolvedValue(null),
    };

    const testContainer = createTestContainer(prodContainer, {
      issueRepository: () => mockRepo,
    });

    // issueService is the real implementation
    await expect(testContainer.cradle.issueService.getIssue("not-found")).rejects.toThrow(
      EntityNotFoundError
    );
  });
});

// =============================================================================
// Compose Tests
// =============================================================================

describe("compose", () => {
  it("should execute middleware in order", async () => {
    const order: number[] = [];

    const middleware1 = async () => {
      order.push(1);
    };
    const middleware2 = async () => {
      order.push(2);
    };
    const middleware3 = async () => {
      order.push(3);
    };

    const chain = compose(middleware1, middleware2, middleware3);
    await chain({}, {});

    expect(order).toEqual([1, 2, 3]);
  });

  it("should stop chain when middleware throws", async () => {
    const order: number[] = [];

    const middleware1 = async () => {
      order.push(1);
    };
    const middleware2 = async () => {
      throw new AuthenticationError("Not authenticated");
    };
    const middleware3 = async () => {
      order.push(3);
    };

    const chain = compose(middleware1, middleware2, middleware3);

    await expect(chain({}, {})).rejects.toThrow(AuthenticationError);
    expect(order).toEqual([1]); // Only first middleware ran
  });

  it("should stop chain and return when middleware returns a value", async () => {
    const order: number[] = [];

    const middleware1 = async () => {
      order.push(1);
    };
    const middleware2 = async () => {
      order.push(2);
      return { earlyReturn: true };
    };
    const middleware3 = async () => {
      order.push(3);
    };

    const chain = compose(middleware1, middleware2, middleware3);
    const result = await chain({}, {});

    expect(order).toEqual([1, 2]); // Third middleware didn't run
    expect(result).toEqual({ earlyReturn: true });
  });
});

describe("createEndpoint", () => {
  it("should run middleware before handler", async () => {
    const order: string[] = [];

    type TestRequest = { data: string };
    type TestContainer = { service: string };

    const middleware = compose<TestRequest, TestContainer, void>(async () => {
      order.push("middleware");
    });

    const handler = async (_req: TestRequest, _container: TestContainer) => {
      order.push("handler");
      return { success: true };
    };

    const endpoint = createEndpoint(handler, middleware);
    const result = await endpoint({ data: "test" }, { service: "test" });

    expect(order).toEqual(["middleware", "handler"]);
    expect(result).toEqual({ success: true });
  });

  it("should not run handler if middleware throws", async () => {
    const handlerCalled = vi.fn();

    type TestRequest = { data: string };
    type TestContainer = { service: string };

    const middleware = compose<TestRequest, TestContainer, void>(async () => {
      throw new ValidationError("name", "required");
    });

    const handler = async (_req: TestRequest, _container: TestContainer) => {
      handlerCalled();
      return { success: true };
    };

    const endpoint = createEndpoint(handler, middleware);

    await expect(endpoint({ data: "test" }, { service: "test" })).rejects.toThrow(ValidationError);
    expect(handlerCalled).not.toHaveBeenCalled();
  });
});

// =============================================================================
// MapError Tests
// =============================================================================

describe("mapError", () => {
  it("should map EntityNotFoundError to 404", () => {
    const error = new EntityNotFoundError("Issue", "123");
    const response = mapError(error);

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Issue not found: 123");
    expect(response.body.code).toBe("ENTITY_NOT_FOUND");
    expect(response.body.details).toEqual({ entityType: "Issue", id: "123" });
  });

  it("should map ValidationError to 400", () => {
    const error = new ValidationError("email", "must be valid");
    const response = mapError(error);

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
    expect(response.body.details).toEqual({ field: "email", reason: "must be valid" });
  });

  it("should map ConflictError to 409", () => {
    const error = new ConflictError("Issue already exists");
    const response = mapError(error);

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("CONFLICT");
  });

  it("should map BusinessRuleError to 422", () => {
    const error = new BusinessRuleError("Cannot close issue with open tasks");
    const response = mapError(error);

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("BUSINESS_RULE_VIOLATION");
  });

  it("should map AuthenticationError to 401", () => {
    const error = new AuthenticationError();
    const response = mapError(error);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
  });

  it("should map AuthorizationError to 403", () => {
    const error = new AuthorizationError();
    const response = mapError(error);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("AUTHORIZATION_DENIED");
  });

  it("should map standard Error to 500", () => {
    const error = new Error("Something went wrong");
    const response = mapError(error);

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("Something went wrong");
    expect(response.body.code).toBeUndefined();
  });

  it("should handle non-Error values", () => {
    const response = mapError("string error");

    expect(response.status).toBe(500);
    expect(response.body.error).toBe("string error");
  });
});

// =============================================================================
// Integration Test - Full Handler Pattern
// =============================================================================

describe("Full Handler Pattern", () => {
  it("should demonstrate the recommended testing pattern", async () => {
    // Define a combined request type that includes all fields needed
    // by both middleware and handler
    interface GetIssueRequest {
      issueId: string;
      userId?: string;
    }

    // 1. Build production container
    const prodContainer = new ContainerBuilder<TestCradle>()
      .registerSingleton("issueRepository", InMemoryIssueRepository)
      .registerScoped("issueService", DefaultIssueService)
      .build();

    // 2. Define middleware (uses same request type)
    const authMiddleware = compose<GetIssueRequest, TestCradle, void>(
      async (req: GetIssueRequest) => {
        if (!req.userId) {
          throw new AuthenticationError();
        }
      }
    );

    // 3. Define endpoint handler (uses same request type)
    const getIssueHandler = async (req: GetIssueRequest, container: TestCradle) => {
      return container.issueService.getIssue(req.issueId);
    };

    // 4. Create endpoint with middleware
    const getIssueEndpoint = createEndpoint(getIssueHandler, authMiddleware);

    // 5. Create test container with mock
    const mockIssue = { id: "issue-1", title: "Test Issue" };
    const mockRepo: IssueRepository = {
      findById: vi.fn().mockResolvedValue(mockIssue),
    };

    const testContainer = createTestContainer(prodContainer, {
      issueRepository: () => mockRepo,
    });

    // 6. Test: authenticated request succeeds
    const result = await getIssueEndpoint(
      { issueId: "issue-1", userId: "user-1" },
      testContainer.cradle
    );
    expect(result).toEqual(mockIssue);

    // 7. Test: unauthenticated request fails
    await expect(getIssueEndpoint({ issueId: "issue-1" }, testContainer.cradle)).rejects.toThrow(
      AuthenticationError
    );

    // 8. Test: not found error
    mockRepo.findById = vi.fn().mockResolvedValue(null);
    await expect(
      getIssueEndpoint({ issueId: "not-found", userId: "user-1" }, testContainer.cradle)
    ).rejects.toThrow(EntityNotFoundError);
  });
});
