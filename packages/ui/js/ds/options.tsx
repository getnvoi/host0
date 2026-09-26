import { Table } from "./table";

// One option of a component: its name and its default as written ("required", "none" or a value).
export type OptionSpec = { name: string; default: string };

// Ds::Options: the options of a component as a table, types and descriptions from docs, { option: [type, text] }.
export type OptionsProps = { of: OptionSpec[]; docs?: Record<string, [string?, string?]> };

export function Options({ of, docs = {} }: OptionsProps) {
  const rows = of.map((option) => {
    const [type, text] = docs[option.name] ?? [];
    return [<code>{option.name}</code>, type && <code>{type}</code>, <code>{option.default}</code>, text];
  });
  return <Table head={["Option", "Type", "Default", "Does"]} rows={rows} />;
}
