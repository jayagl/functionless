import { ApiGatewayVtlIntegration } from "./api";
import { AppSyncVtlIntegration } from "./appsync";
import { ASL, State } from "./asl";
import { EventBus, EventBusTargetIntegration } from "./event-bridge";
import { AwaitExpr, CallExpr, PromiseExpr, ReferenceExpr } from "./expression";
import { Function, NativeIntegration } from "./function";
import {
  isAwaitExpr,
  isCallExpr,
  isPromiseExpr,
  isReferenceExpr,
} from "./guards";
import { FunctionlessNode } from "./node";
import { AnyFunction } from "./util";
import { visitEachChild } from "./visit";
import { VTL } from "./vtl";

export const isIntegration = <I extends IntegrationInput<string, AnyFunction>>(
  i: any
): i is I => typeof i === "object" && "kind" in i;

export type IntegrationCallExpr = CallExpr & { expr: ReferenceExpr };

export function isIntegrationCallExpr(
  node: FunctionlessNode
): node is IntegrationCallExpr {
  return isCallExpr(node) && isReferenceExpr(node.expr);
}

export type IntegrationCallPattern =
  | IntegrationCallExpr
  | (AwaitExpr & { expr: IntegrationCallExpr })
  | (PromiseExpr & { expr: IntegrationCallExpr })
  | (AwaitExpr & { expr: PromiseExpr & { expr: IntegrationCallExpr } });

export function isIntegrationCallPattern(
  node: FunctionlessNode
): node is IntegrationCallPattern {
  return (
    (isAwaitExpr(node) &&
      isPromiseExpr(node.expr) &&
      isIntegrationCallExpr(node.expr.expr)) ||
    (isAwaitExpr(node) && isIntegrationCallExpr(node.expr)) ||
    (isPromiseExpr(node) && isIntegrationCallExpr(node.expr)) ||
    isIntegrationCallExpr(node)
  );
}

/**
 * Give the possible ways to define an integration, return just the call(ref) of the integration.
 */
export function getIntegrationExprFromIntegrationCallPattern(
  pattern: IntegrationCallPattern
): IntegrationCallExpr {
  if (isAwaitExpr(pattern)) {
    if (isIntegrationCallExpr(pattern.expr)) {
      return pattern.expr;
    } else if (
      isPromiseExpr(pattern.expr) &&
      isIntegrationCallExpr(pattern.expr.expr)
    ) {
      return pattern.expr.expr;
    }
  } else if (isPromiseExpr(pattern) && isIntegrationCallExpr(pattern.expr)) {
    return pattern.expr;
  }
  return pattern as IntegrationCallExpr;
}

/**
 * Maintain a typesafe runtime map of integration type keys to use elsewhere.
 *
 * For example, removing all but native integration from the {@link Function} closure.
 */
const INTEGRATION_TYPES: { [P in keyof IntegrationMethods<any>]: P } = {
  appSyncVtl: "appSyncVtl",
  apiGWVtl: "apiGWVtl",
  asl: "asl",
  native: "native",
  eventBus: "eventBus",
};

export const INTEGRATION_TYPE_KEYS = Object.values(INTEGRATION_TYPES);

/**
 * All integration methods supported by functionless.
 */
export interface IntegrationMethods<
  F extends AnyFunction,
  EventBusInteg extends EventBusTargetIntegration<
    any,
    any
  > = EventBusTargetIntegration<any, any>
> {
  /**
   * Integrate with AppSync VTL applications.
   * @private
   */
  appSyncVtl: AppSyncVtlIntegration;
  /**
   * Integrate with API Gateway VTL applications.
   * @private
   */
  apiGWVtl: ApiGatewayVtlIntegration;
  /**
   * Integrate with ASL applications like StepFunctions.
   *
   * TODO: Update to use an interface https://github.com/functionless/functionless/issues/197
   *
   * @private
   */
  asl: (call: CallExpr, context: ASL) => Omit<State, "Next">;
  eventBus: EventBusInteg;
  /**
   * Native javascript code integrations that execute at runtime like Lambda.
   */
  native: NativeIntegration<F>;
}

/**
 * Integration types supported by Functionless.
 *
 * Add an integration by creating any object that has a property named "kind" and either implements the
 * {@link Integration} interface or has methods that implement it (or both).
 *
 * Example showing both strategies:
 *
 * ```ts
 * export class Function implements {@link Integration} {
 *    readonly kind = "Function",
 *
 *    // Integration Handler for ASL
 *    public asl(call, context) {
 *       // return Step Function task.
 *    }
 *
 *    // Example class method - some wrapper function that generates special ASL tasks when using a Function.
 *    public specialPayload = makeIntegration<() => string>({
 *        kind: "Function.default",
 *        asl: (call, context) => {
 *            // return step function task
 *        }
 *    });
 * }
 *
 * // an interface to provide the actual callable methods to users
 * export interface Function {
 *    // call me to send a string payload
 *    (payload: String) => string
 * }
 *
 * // use
 *
 * const func1 = new Function(...);
 * // uses the ASL
 * new StepFunction(..., async () => {
 *    await func1("some string");
 *    // Calling our special method in a step function closure
 *    await func1.specialPayload();
 * })
 * ```
 *
 * If an integration does not support an integration type, leave the function undefined or throw an error.
 *
 * Implement the unhandledContext function to customize the error message for unsupported contexts.
 * Otherwise the error will be: `${this.name} is not supported by context ${context.kind}.`
 */
export interface Integration<
  K extends string = string,
  F extends AnyFunction = AnyFunction,
  EventBus extends EventBusTargetIntegration<
    any,
    any
  > = EventBusTargetIntegration<any, any>
> extends Partial<IntegrationMethods<F, EventBus>> {
  /**
   * Brand the Function, F, into this type so that sub-typing rules apply to the function signature.
   */
  __functionBrand: F;
  /**
   * Integration Handler kind - for example StepFunction.describeExecution
   */
  readonly kind: K;
  /**
   * Optional method that allows overriding the {@link Error} thrown when a integration is not supported by a handler.
   * @param kind - The Kind of the integration.
   * @param contextKind - the Kind of the context attempting to use the integration.
   */
  readonly unhandledContext?: (
    kind: string,
    contextKind: CallContext["kind"]
  ) => Error;
}

/**
 * Alias that removes computed inputs from the integration interface
 */
export type IntegrationInput<
  K extends string = string,
  F extends AnyFunction = AnyFunction
> = Omit<Integration<K, F>, "__functionBrand">;

/**
 * Internal wrapper class for Integration handlers that provides default error handling for unsupported integrations.
 *
 * Functionless wraps Integration at runtime with this class.
 * @private
 */
export class IntegrationImpl<F extends AnyFunction = AnyFunction>
  implements IntegrationMethods<F>
{
  readonly kind: string;
  constructor(readonly integration: Integration) {
    if (!integration) {
      throw Error("Integrations cannot be undefined.");
    }
    this.kind = integration.kind;
  }

  private assertIntegrationDefined<I>(
    contextKind: CallContext["kind"],
    integration?: I
  ): I {
    if (integration) {
      return integration;
    } else if (this.integration.unhandledContext) {
      throw this.integration.unhandledContext(this.kind, contextKind);
    }
    throw Error(`${this.kind} is not supported by context ${contextKind}.`);
  }

  public get appSyncVtl(): AppSyncVtlIntegration {
    return this.assertIntegrationDefined(
      "Velocity Template",
      this.integration.appSyncVtl
    );
  }

  public get apiGWVtl(): ApiGatewayVtlIntegration {
    return this.assertIntegrationDefined(
      // TODO: differentiate Velocity Template?
      "Velocity Template",
      this.integration.apiGWVtl
    );
  }

  // TODO: Update to use an interface https://github.com/functionless/functionless/issues/197
  public asl(call: CallExpr, context: ASL): Omit<State, "Next"> {
    return this.assertIntegrationDefined(
      context.kind,
      this.integration.asl
    ).bind(this.integration)(call, context);
  }

  public get eventBus(): EventBusTargetIntegration<any, any> {
    return this.assertIntegrationDefined("EventBus", this.integration.eventBus);
  }

  public get native(): NativeIntegration<F> {
    return this.assertIntegrationDefined("Function", this.integration.native);
  }
}

export type IntegrationCall<K extends string, F extends AnyFunction> = {
  FunctionlessType: K;
  kind: K;
  __functionBrand: F;
} & F;

/**
 * Helper method which masks an {@link Integration} object as a function of any form.
 *
 * ```ts
 * export namespace MyIntegrations {
 *    export const callMe = makeIntegration<(payload: string) => void>({
 *       asl: (call, context) => { ... }
 *    })
 * }
 * ```
 *
 * Creates an integration object at callMe, which is callable by a user.
 *
 * ```ts
 * MyIntegrations.callMe("some string");
 * ```
 *
 * @private
 */
export function makeIntegration<K extends string, F extends AnyFunction>(
  integration: IntegrationInput<K, F>
): IntegrationCall<K, F> {
  return integration as unknown as IntegrationCall<K, F>;
}

export type CallContext = ASL | VTL | Function<any, any> | EventBus<any>;

/**
 * Dive until we find a integration object.
 */
export function findDeepIntegrations(
  expr: FunctionlessNode
): IntegrationCallExpr[] {
  const integrations: IntegrationCallExpr[] = [];
  visitEachChild(expr, function find(node: FunctionlessNode): FunctionlessNode {
    if (isIntegrationCallExpr(node)) {
      integrations.push(node);
    }
    return visitEachChild(node, find);
  });
  return integrations;
}

// to prevent the closure serializer from trying to import all of functionless.
export const deploymentOnlyModule = true;
