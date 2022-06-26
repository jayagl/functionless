import { assertNever, assertNodeKind } from "./assert";
import { BindingPattern } from "./declaration";
import {} from "./error";
import { ErrorCodes, SynthError } from "./error-code";
import { CallExpr, Expr, FunctionExpr, Identifier } from "./expression";
import {
  isArgument,
  isArrayBinding,
  isArrayLiteralExpr,
  isAwaitExpr,
  isBinaryExpr,
  isBindingElem,
  isBindingPattern,
  isBlockStmt,
  isBooleanLiteralExpr,
  isBreakStmt,
  isCallExpr,
  isCatchClause,
  isComputedPropertyNameExpr,
  isConditionExpr,
  isContinueStmt,
  isDoStmt,
  isElementAccessExpr,
  isErr,
  isExprStmt,
  isForInStmt,
  isForOfStmt,
  isFunctionDecl,
  isFunctionExpr,
  isIdentifier,
  isIfStmt,
  isNewExpr,
  isNullLiteralExpr,
  isNumberLiteralExpr,
  isObjectLiteralExpr,
  isParameterDecl,
  isPromiseArrayExpr,
  isPromiseExpr,
  isPropAccessExpr,
  isPropAssignExpr,
  isReferenceExpr,
  isReturnStmt,
  isSpreadAssignExpr,
  isSpreadElementExpr,
  isStmt,
  isStringLiteralExpr,
  isTemplateExpr,
  isThrowStmt,
  isTryStmt,
  isTypeOfExpr,
  isUnaryExpr,
  isUnaryPostfixExpr,
  isUndefinedLiteralExpr,
  isVariableStmt,
  isWhileStmt,
} from "./guards";
import { Integration, IntegrationImpl, isIntegration } from "./integration";
import { FunctionlessNode } from "./node";
import { Stmt, VariableStmt } from "./statement";
import { AnyFunction, isInTopLevelScope } from "./util";

// https://velocity.apache.org/engine/devel/user-guide.html#conditionals
// https://cwiki.apache.org/confluence/display/VELOCITY/CheckingForNull
// https://velocity.apache.org/engine/devel/user-guide.html#set

export function isVTL(a: any): a is VTL {
  return (a as VTL | undefined)?.kind === VTL.ContextName;
}

export abstract class VTL {
  static readonly ContextName = "Velocity Template";

  readonly kind = VTL.ContextName;

  private readonly statements: string[] = [];

  private varIt = 0;

  constructor(...statements: string[]) {
    this.statements.push(...statements);
  }

  public toVTL(): string {
    return this.statements.join("\n");
  }

  public add(...statements: string[]) {
    this.statements.push(...statements);
  }

  protected newLocalVarName(): `$v${string}` {
    return `$v${(this.varIt += 1)}`;
  }

  public str(value: string) {
    return `'${value}'`;
  }

  /**
   * Converts a variable {@link reference} to JSON using the built-in `$util.toJson` intrinsic function.
   *
   * @param reference variable reference
   * @returns VTL expression which yields a JSON string of the variable {@link reference}.
   */
  public json(reference: string): string {
    return `$util.toJson(${reference})`;
  }

  /**
   * Evaluates an {@link expr} with the `$util.qr` statement.
   *
   * @param expr expression string to evaluate quietly (i.e. without emitting to output) .
   */
  public qr(expr: string): void {
    this.add(`$util.qr(${expr})`);
  }

  /**
   * Add a statement which sets the variable {@link reference} to the value of the {@link expr}.
   *
   * @param reference the name of the variable to set
   * @param expr the value to set the variable to
   */
  public set(reference: string, expr: Expr | string): string {
    this.add(
      `#set(${reference} = ${
        typeof expr === "string" ? expr : this.eval(expr)
      })`
    );
    return reference;
  }

  /**
   * Stores the {@link expr} in a new variable with a uniquely generated name.
   *
   * @param expr the expression
   * @returns the variable name that contains the value.
   */
  public var(expr: string | Expr): string {
    return this.set(this.newLocalVarName(), expr);
  }

  /**
   * The put method on an object.
   *
   * $var.put("name", "value")
   *
   * @param objVar should be a variable referencing an object.
   * @param name should be a quoted string or variable that represents the name to set in the object
   * @param expr should be a quoted string or a variable that represents the value to set
   */
  public put(objVar: string, name: string, expr: string | Expr) {
    this.qr(
      `${objVar}.put(${name}, ${
        typeof expr === "string" ? expr : this.eval(expr)
      })`
    );
  }

  /**
   * The putAll method on an object.
   *
   * $var.putAll($otherObj)
   *
   * @param objVar should be a variable referencing an object.
   * @param expr should be a variable that represents an object to merge with the expression
   */
  public putAll(objVar: string, expr: Expr) {
    this.qr(`${objVar}.putAll(${this.eval(expr)})`);
  }

  /**
   * Evaluate and return an {@link expr}.
   *
   * @param expr expression to evaluate
   * @returns a `#return` VTL expression.
   */
  public return(expr: string | Expr): void {
    if (typeof expr === "string") {
      this.add(`#return(${expr})`);
    } else {
      return this.return(this.eval(expr));
    }
  }

  public printExpr(val: string | Expr) {
    return typeof val === "string" ? val : this.eval(val);
  }

  public printBody(body: string | Stmt | (() => void)) {
    if (isStmt(body)) {
      this.eval(body);
    } else if (typeof body === "string") {
      this.add(body);
    } else {
      body();
    }
  }

  public ifStmt(
    condition: string | Expr,
    body: string | Stmt | (() => void),
    elseBody?: string | Stmt | (() => void),
    _returnVariable?: string
  ) {
    this.add(`#if(${this.printExpr(condition)})`);
    this.printBody(body);
    if (elseBody) {
      this.add("#else");
      this.printBody(elseBody);
    }
    this.add("#end");
  }

  public foreach(
    iterVar: string | Expr | VariableStmt,
    iterValue: string | Expr,
    body: string | Stmt | (() => void)
  ) {
    if (isVariableStmt(iterVar)) {
      if (isBindingPattern(iterVar.name)) {
        // iterate into a temp variable
        const tempVar = this.newLocalVarName();
        this.add(`#foreach(${tempVar} in ${this.printExpr(iterValue)})`);
        // deconstruct from the temp variable
        this.evaluateBindingPattern(iterVar.name, tempVar);
      } else {
        this.add(`#foreach($${iterVar.name} in ${this.printExpr(iterValue)})`);
      }
    } else {
      this.add(
        `#foreach(${this.printExpr(iterVar)} in ${this.printExpr(iterValue)})`
      );
    }
    this.printBody(body);
    this.add("#end");
  }

  /**
   * Call a service API. The Call expression will be evaluated and JSON will be rendered
   * to the Velocity Template output. This JSON payload will be passed to the
   * service-to-service integration, e.g. a Dynamo API request.
   *
   * ```json
   * #set($payload = {
   *   "operation": "GetItem",
   *   "key": $util.toJson($util.toDynamoDB($key)),
   * })
   * $util.toJson($payload)
   * ```
   * @param call
   */
  public call(call: CallExpr): void {
    this.add(this.eval(call));
  }

  /**
   * Configure the integration between this VTL template and a target service.
   * @param target the target service to integrate with.
   * @param call the CallExpr representing the integration logic
   */
  protected abstract integrate(
    target: IntegrationImpl<AnyFunction> | undefined,
    call: CallExpr
  ): string;

  protected abstract dereference(id: Identifier): string;

  /**
   * Evaluate an {@link Expr} or {@link Stmt} by emitting statements to this VTL template and
   * return a variable reference to the evaluated value.
   *
   * @param node the {@link Expr} or {@link Stmt} to evaluate.
   * @returns a variable reference to the evaluated value
   */
  public eval(node?: Expr, returnVar?: string): string;
  public eval(node: Stmt, returnVar?: string): void;
  public eval(node?: FunctionlessNode, returnVar?: string): string | void {
    if (!node) {
      return "$null";
    }
    if (isArrayLiteralExpr(node)) {
      if (node.items.find(isSpreadElementExpr) === undefined) {
        return `[${node.items.map((item) => this.eval(item)).join(", ")}]`;
      } else {
        // contains a spread, e.g. [...i], so we will store in a variable
        const list = this.var("[]");
        for (const item of node.items) {
          if (isSpreadElementExpr(item)) {
            this.qr(`${list}.addAll(${this.eval(item.expr)})`);
          } else {
            // we use addAll because `list.push(item)` is pared as `list.push(...[item])`
            // - i.e. the compiler passes us an ArrayLiteralExpr even if there is one arg
            this.qr(`${list}.add(${this.eval(item)})`);
          }
        }
        return list;
      }
    } else if (isBinaryExpr(node)) {
      if (node.op === "in") {
        throw new SynthError(
          ErrorCodes.Unexpected_Error,
          "Expected the `in` binary operator to be re-written before this point"
        );
      } else if (node.op === "=") {
        const v = this.eval(node.left);
        this.set(v, this.eval(node.right));
        return v;
      } else if (node.op === "??") {
        const v = this.newLocalVarName();
        const left = this.var(node.left);
        this.ifStmt(
          left,
          () => {
            this.set(v, left);
          },
          () => {
            this.set(v, node.right);
          }
        );
        return v;
      } else if (["+=", "-=", "*=", "/=", "%="].includes(node.op)) {
        return this.set(
          this.eval(node.left),
          `${this.eval(node.left)} ${node.op[0]} ${this.eval(node.right)}`
        );
      }
      // VTL fails to evaluate binary expressions inside an object put e.g. $obj.put('x', 1 + 1)
      // a workaround is to use a temp variable.
      return this.var(
        `${this.eval(node.left)} ${node.op} ${this.eval(node.right)}`
      );
    } else if (isBlockStmt(node)) {
      for (const stmt of node.statements) {
        this.eval(stmt);
      }
      return undefined;
    } else if (isBooleanLiteralExpr(node)) {
      return `${node.value}`;
    } else if (isBreakStmt(node)) {
      return this.add("#break");
    } else if (isCallExpr(node)) {
      if (isReferenceExpr(node.expr)) {
        const ref = node.expr.ref();
        if (isIntegration<Integration>(ref)) {
          const serviceCall = new IntegrationImpl(ref);
          return this.integrate(serviceCall, node);
        } else {
          throw new SynthError(
            ErrorCodes.Unexpected_Error,
            "Called references are expected to be an integration."
          );
        }
      } else if (
        // If the parent is a propAccessExpr
        isPropAccessExpr(node.expr) &&
        (node.expr.name === "map" ||
          node.expr.name === "forEach" ||
          node.expr.name === "reduce")
      ) {
        if (node.expr.name === "map" || node.expr.name == "forEach") {
          // list.map(item => ..)
          // list.map((item, idx) => ..)
          // list.forEach(item => ..)
          // list.forEach((item, idx) => ..)
          const newList = node.expr.name === "map" ? this.var("[]") : undefined;

          const [value, index, array] = getMapForEachArgs(node);

          // Try to flatten any maps before this operation
          // returns the first variable to be used in the foreach of this operation (may be the `value`)
          const list = this.flattenListMapOperations(
            node.expr.expr,
            value,
            (firstVariable, list) => {
              this.add(`#foreach(${firstVariable} in ${list})`);
            },
            // If array is present, do not flatten the map, this option immediately evaluates the next expression
            !!array
          );

          // Render the body
          const tmp = this.renderMapOrForEachBody(
            node,
            list,
            // the return location will be generated
            undefined,
            index,
            array
          );

          // Add the final value to the array
          if (node.expr.name === "map") {
            this.qr(`${newList}.add(${tmp})`);
          }

          this.add("#end");
          return newList ?? "$null";
        } else if (node.expr.name === "reduce") {
          // list.reduce((result: string[], next) => [...result, next], []);
          // list.reduce((result, next) => [...result, next]);

          const fn = assertNodeKind<FunctionExpr>(
            node.getArgument("callbackfn")?.expr,
            "FunctionExpr"
          );
          const initialValue = node.getArgument("initialValue")?.expr;

          // (previousValue: string[], currentValue: string, currentIndex: number, array: string[])
          const previousValue = fn.parameters[0]?.name
            ? `$${fn.parameters[0].name}`
            : this.newLocalVarName();
          const currentValue = fn.parameters[1]?.name
            ? `$${fn.parameters[1].name}`
            : this.newLocalVarName();
          const currentIndex = fn.parameters[2]?.name
            ? `$${fn.parameters[2].name}`
            : undefined;
          const array = fn.parameters[3]?.name
            ? `$${fn.parameters[3].name}`
            : undefined;

          // create a new local variable name to hold the initial/previous value
          // this is because previousValue may not be unique and isn't contained within the loop
          const previousTmp = this.newLocalVarName();

          const list = this.flattenListMapOperations(
            node.expr.expr,
            currentValue,
            (firstVariable, list) => {
              if (initialValue !== undefined) {
                this.set(previousTmp, initialValue);
              } else {
                this.ifStmt(
                  `${list}.isEmpty()`,
                  "$util.error('Reduce of empty array with no initial value')"
                );
              }

              this.add(`#foreach(${firstVariable} in ${list})`);
            },
            // If array is present, do not flatten maps before the reduce, this option immediately evaluates the next expression
            !!array
          );

          if (currentIndex) {
            this.add(`#set(${currentIndex} = $foreach.index)`);
          }
          if (array) {
            this.add(`#set(${array} = ${list})`);
          }

          const body = () => {
            // set previousValue variable name to avoid remapping
            this.set(previousValue, previousTmp);
            const tmp = this.newLocalVarName();
            for (const stmt of fn.body.statements) {
              this.eval(stmt, tmp);
            }
            // set the previous temp to be used later
            this.set(previousTmp, `${tmp}`);

            this.add("#end");
          };

          if (initialValue === undefined) {
            this.ifStmt(
              "$foreach.index == 0",
              () => {
                this.set(previousTmp, currentValue);
              },
              body
            );
          } else {
            body();
          }

          return previousTmp;
        } else if (
          isIdentifier(node.expr.expr) &&
          node.expr.expr.name === "Promise"
        ) {
          throw new SynthError(
            ErrorCodes.Unsupported_Use_of_Promises,
            "Appsync does not support concurrent integration invocation or methods on the `Promise` api."
          );
        }
        // this is an array map, forEach, reduce call
      }
      return `${this.eval(node.expr)}(${Object.values(node.args)
        .map((arg) => this.eval(arg))
        .join(", ")})`;
    } else if (isConditionExpr(node)) {
      const val = this.newLocalVarName();
      this.ifStmt(
        node.when,
        () => {
          this.set(val, node.then);
        },
        () => {
          this.set(val, node._else);
        }
      );
      return val;
    } else if (isIfStmt(node)) {
      return this.ifStmt(node.when, node.then, node._else);
    } else if (isExprStmt(node)) {
      return this.qr(this.eval(node.expr));
    } else if (isForInStmt(node) || isForOfStmt(node)) {
      this.foreach(
        node.variableDecl,
        `${this.eval(node.expr)}${isForInStmt(node) ? ".keySet()" : ""}`,
        node.body
      );
      return undefined;
    } else if (isFunctionDecl(node)) {
      // there should never be nested functions
    } else if (isFunctionExpr(node)) {
      return this.eval(node.body);
    } else if (isIdentifier(node)) {
      return this.dereference(node);
    } else if (isNewExpr(node)) {
      throw new Error("NewExpr is not supported by Velocity Templates");
    } else if (isPropAccessExpr(node)) {
      let name = node.name;
      if (name === "push" && isCallExpr(node.parent)) {
        // this is a push to an array, rename to 'addAll'
        // addAll because the var-args are converted to an ArrayLiteralExpr
        name = "addAll";
      }
      return `${this.eval(node.expr)}.${name}`;
    } else if (isElementAccessExpr(node)) {
      return `${this.eval(node.expr)}[${this.eval(node.element)}]`;
    } else if (isNullLiteralExpr(node) || isUndefinedLiteralExpr(node)) {
      return "$null";
    } else if (isNumberLiteralExpr(node)) {
      return node.value.toString(10);
    } else if (isObjectLiteralExpr(node)) {
      const obj = this.var("{}");
      for (const prop of node.properties) {
        if (isPropAssignExpr(prop)) {
          const name = isIdentifier(prop.name)
            ? this.str(prop.name.name)
            : this.eval(prop.name);
          this.put(obj, name, prop.expr);
        } else if (isSpreadAssignExpr(prop)) {
          this.putAll(obj, prop.expr);
        } else {
          assertNever(prop);
        }
      }
      return obj;
    } else if (isComputedPropertyNameExpr(node)) {
      return this.eval(node.expr);
    } else if (
      isParameterDecl(node) ||
      isReferenceExpr(node) ||
      isPropAssignExpr(node)
    ) {
      throw new Error(`cannot evaluate Expr kind: '${node.kind}'`);
    } else if (isReturnStmt(node)) {
      if (returnVar) {
        this.set(returnVar, node.expr ?? "$null");
      } else {
        this.set("$context.stash.return__val", node.expr ?? "$null");
        this.add("#set($context.stash.return__flag = true)");
        this.add("#return($context.stash.return__val)");
      }
      return undefined;
    } else if (isSpreadAssignExpr(node) || isSpreadElementExpr(node)) {
      // handled inside ObjectLiteralExpr
    } else if (isStringLiteralExpr(node)) {
      return this.str(node.value);
    } else if (isTemplateExpr(node)) {
      return `"${node.exprs
        .map((expr) => {
          if (isStringLiteralExpr(expr)) {
            return expr.value;
          }
          const text = this.eval(expr, returnVar);
          if (text.startsWith("$")) {
            return `\${${text.slice(1)}}`;
          } else {
            const varName = this.var(text);
            return `\${${varName.slice(1)}}`;
          }
        })
        .join("")}"`;
    } else if (isUnaryExpr(node)) {
      // VTL fails to evaluate unary expressions inside an object put e.g. $obj.put('x', -$v1)
      // a workaround is to use a temp variable.
      // it also doesn't handle like - signs alone (e.g. - $v1) so we have to put a 0 in front
      // no such problem with ! signs though
      if (node.op === "++" || node.op === "--") {
        this.set(
          this.eval(node.expr),
          `${this.eval(node.expr)} ${node.op === "++" ? "+" : "-"} 1`
        );
        return this.eval(node.expr);
      } else if (node.op === "-") {
        return this.var(`0 - ${this.eval(node.expr)}`);
      } else {
        return this.var(`${node.op}${this.eval(node.expr)}`);
      }
    } else if (isUnaryPostfixExpr(node)) {
      const temp = this.var(node.expr);
      this.set(
        this.eval(node.expr),
        `${this.eval(node.expr)} ${node.op === "++" ? "+" : "-"} 1`
      );
      return temp;
    } else if (isVariableStmt(node)) {
      const variablePrefix = isInTopLevelScope(node) ? `$context.stash.` : `$`;
      if (isBindingPattern(node.name)) {
        if (!node.expr) {
          throw new SynthError(
            ErrorCodes.Unexpected_Error,
            "Expected an initializer for a binding pattern assignment"
          );
        }
        const right = this.var(node.expr);
        this.evaluateBindingPattern(node.name, right, variablePrefix);
        // may generate may variables, return nothing.
        return undefined;
      } else {
        const varName = `${variablePrefix}${node.name}`;

        if (node.expr) {
          return this.set(varName, node.expr);
        } else {
          return varName;
        }
      }
    } else if (isThrowStmt(node)) {
      return `#throw(${this.eval(node.expr)})`;
    } else if (isTryStmt(node)) {
    } else if (isCatchClause(node)) {
    } else if (isContinueStmt(node)) {
    } else if (isDoStmt(node)) {
    } else if (isTypeOfExpr(node)) {
    } else if (isWhileStmt(node)) {
    } else if (isAwaitExpr(node)) {
      // we will check for awaits on the PromiseExpr
      return this.eval(node.expr);
    } else if (isPromiseExpr(node)) {
      // if we find a promise, ensure it is wrapped in Await or returned then unwrap it
      if (isAwaitExpr(node.parent) || isReturnStmt(node.parent)) {
        return this.eval(node.expr);
      }
      throw new SynthError(
        ErrorCodes.Integration_must_be_immediately_awaited_or_returned
      );
    } else if (isPromiseArrayExpr(node)) {
      throw new SynthError(
        ErrorCodes.Unsupported_Use_of_Promises,
        "Appsync does not support concurrent integration invocation."
      );
    } else if (isErr(node)) {
      throw node.error;
    } else if (isArgument(node)) {
      return this.eval(node.expr);
    } else if (isBindingElem(node) || isBindingPattern(node)) {
      throw new SynthError(
        ErrorCodes.Unexpected_Error,
        "BindingElm and BindingPatterns should be handled locally (ex: VariableStmt)"
      );
    } else {
      return assertNever(node);
    }
    debugger;
    throw new Error(`cannot evaluate Expr kind: '${node.kind}'`);
  }

  /**
   * Expands a destructure/binding declaration to separate variable declarations in velocity
   *
   * Applies default values.
   * Supports "rest" destructure expressions.
   *
   * const { a } = b;
   *         ^ name ^ right side of var stmt
   * => a = b.a
   * const { a : b } = c;
   *        ^prop ^name ^ right side of var stmt
   * => b = b.c
   * const { a: { b } } = c;
   *         ^parent prop name
   *              ^ name  ^ right side of var statement
   * => b = c.a.b
   * const { a: { b = 1 } = {} } = c;
   * => temp1 = c.a ? c.a : {}
   *    b = temp1.b ? temp1.b : 1
   *
   * { a } = b;
   * =>
   * const a = b.a;
   *
   * { a, c } = b;
   * =>
   * const a = b.a;
   * const c = b.c;
   *
   * { a: { c } } = b;
   * =>
   * const c = b.a.c;
   *
   * { a, ...rest } = b;
   * =>
   * const a = b.a;
   * const rest = {}
   * for(key in b)
   *   rest[key] = b[key]
   *
   * { a: c } = b;
   * =>
   * const c = b.a;
   *
   * { a: [c] } = b;
   * =>
   * const c = b.a[0];
   *
   * [a] = b;
   * =>
   * b[0]
   *
   * [ a, c ] = b;
   * =>
   * const a = b[0]
   * const c = b[1]
   *
   * [ a, ...rest ] = b;
   * =>
   * const a = b[0]
   * const rest = []
   * for(key in b)
   *    if(key > 0)
   *      rest.push(b[key])
   *
   * [ a: { c } ] = b;
   * =>
   * const c = b[0].c;
   *
   * [a, ...rest] = b
   * const a = b[0]
   * const rest = b[1..]
   */
  public evaluateBindingPattern(
    pattern: BindingPattern,
    target: string,
    variablePrefix: string = "$"
  ) {
    const rest = pattern.bindings.find((binding) => binding?.rest);
    const properties = pattern.bindings.map((binding, i) => {
      /**
       * OmitElement for ArrayBinding, skip
       */
      if (!binding || binding === rest) {
        return;
      }

      const accessor: string | undefined = isArrayBinding(pattern)
        ? `[${i}]`
        : binding.propertyName
        ? isIdentifier(binding.propertyName)
          ? `.${binding.propertyName.name}`
          : isStringLiteralExpr(binding.propertyName)
          ? `[${this.str(binding.propertyName.value)}]`
          : `[${this.eval(binding.propertyName)}]`
        : isIdentifier(binding.name)
        ? `.${binding.name.name}`
        : undefined;

      if (!accessor) {
        // This shouldn't happen, but lets error if it does!
        // when the name is a bindingPattern, the propName should be present.
        // when the name is an identifier, the propertyName is optional
        debugger;
        throw new SynthError(
          ErrorCodes.Unexpected_Error,
          "Could not find property name for binding element."
        );
      }

      const next = (() => {
        if (binding.initializer) {
          const temp = this.var(`${target}${accessor}`);
          this.ifStmt(`!${temp}`, () => {
            this.set(temp, this.eval(binding.initializer));
          });
          return temp;
        }
        return `${target}${accessor}`;
      })();

      if (isBindingPattern(binding.name)) {
        this.evaluateBindingPattern(binding.name, next, variablePrefix);
      } else {
        this.set(`${variablePrefix}${binding.name.name}`, next);
      }

      return accessor;
    });

    if (rest) {
      // temp variable to write the new array or object in.
      // If the rest is another binding pattern, this variable is used as the new target.
      const restTemp = this.newLocalVarName();
      if (isArrayBinding(pattern)) {
        // take the sublist of the target array that was not in the binding pattern
        // #set($rest = $list.subList([binding count - 1], $list.size()))
        this.set(
          restTemp,
          `${target}.subList(${pattern.bindings.length - 1}, ${target}.size())`
        );
      } else {
        // compute an array of the properties bound from the object
        const userProps = properties
          .filter((p): p is string => !!p)
          .map((p) =>
            // strip off the accessor patterns
            p.startsWith(".") ? p.slice(1) : p.slice(1, p.length - 1)
          );
        // create a new object
        this.set(restTemp, `{}`);
        // create a new variable to use in the loop
        const keyVar = this.newLocalVarName();
        // create an array with all of the used properties
        const keys = this.var(`[${userProps.map(this.str).join(",")}]`);
        // copy all properties not in the keys array into the new object
        this.foreach(keyVar, `${target}.keySet()`, () => {
          this.ifStmt(`!${keys}.contains(${keyVar})`, () => {
            this.set(`${restTemp}[${keyVar}]`, `${target}[${keyVar}]`);
          });
        });
      }

      // rest pattern supports a named rest variable
      // const { ... rest }
      // or another binding pattern
      // const { ... { a, b } }
      // weird, right?
      if (isIdentifier(rest.name)) {
        this.set(this.eval(rest.name), restTemp);
      } else {
        this.evaluateBindingPattern(rest.name, restTemp);
      }
    }
  }

  /**
   * Adds the VTL required to execute the body of a single map or forEach.
   *
   * @param call the map or foreach to render
   * @param list the list to give to the `array` parameter, should be the same one used in the vtl foreach
   * @param returnVariable The variable to put the final map value into. If not provided, will be generated.
   *                       Should start with a '$'.
   * @param index The optional `index` variable name to add if present.
   *              Should start with a '$'.
   * @param array The optional `array` variable name to add if present.
   *              Should start with a '$'.
   * @returns The returnVariable or generated variable name.
   */
  private renderMapOrForEachBody(
    call: CallExpr,
    list: string,
    // Should start with $
    returnVariable?: string,
    index?: string,
    array?: string
  ) {
    if (index) {
      this.add(`#set(${index} = $foreach.index)`);
    }
    if (array) {
      this.add(`#set(${array} = ${list})`);
    }

    const fn = assertNodeKind<FunctionExpr>(
      call.getArgument("callbackfn")?.expr,
      "FunctionExpr"
    );

    const tmp = returnVariable ? returnVariable : this.newLocalVarName();

    for (const stmt of fn.body.statements) {
      this.eval(stmt, tmp);
    }

    return tmp;
  }

  /**
   * Recursively flattens map operations until a non-map or a map with `array` parameter is found.
   * Evaluates the expression after the last map.
   *
   * @param before a method which executes once the
   * @return [firstVariable, list variable, render function]
   */
  private flattenListMapOperations(
    expr: Expr,
    // Should start with $
    returnVariable: string,
    before: (firstVariable: string, list: string) => void,
    alwaysEvaluate?: boolean
  ): string {
    if (
      !alwaysEvaluate &&
      isCallExpr(expr) &&
      isPropAccessExpr(expr.expr) &&
      expr.expr.name === "map"
    ) {
      const [value, index, array] = getMapForEachArgs(expr);

      const next = expr.expr.expr;

      const list = this.flattenListMapOperations(
        next,
        value,
        before,
        // If we find array, the next expression should be evaluated.
        // A map which relies on `array` cannot be flattened further as the array will be inaccurate.
        !!array
      );

      this.renderMapOrForEachBody(expr, list, returnVariable, index, array);

      return list;
    }

    const list = this.eval(expr);

    before(returnVariable, list);

    // If the expression isn't a map, return the expression and return variable, render nothing
    return list;
  }
}

/**
 * Returns the [value, index, array] arguments if this CallExpr is a `forEach` or `map` call.
 */
const getMapForEachArgs = (call: CallExpr) => {
  const fn = assertNodeKind<FunctionExpr>(
    call.getArgument("callbackfn")?.expr,
    "FunctionExpr"
  );
  return fn.parameters.map((p) => (p.name ? `$${p.name}` : p.name));
};

// to prevent the closure serializer from trying to import all of functionless.
export const deploymentOnlyModule = true;
