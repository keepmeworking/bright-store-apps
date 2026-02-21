import { PropsWithChildren } from "react";

export function GraphQLProvider(props: PropsWithChildren<{}>) {
  // simplified pass-through for scaffolding
  return <>{props.children}</>;
}
