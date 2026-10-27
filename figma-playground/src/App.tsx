import { Component, type ComponentType, type ReactNode } from "react";
import "./App.css";

// Cada carpeta que deja npm run react (src/components/<Componente>/) exporta su componente desde
// index.ts; sus tokens.css se cargan de forma global, como en un proyecto real
const modules = import.meta.glob<Record<string, unknown>>("./components/*/index.ts", { eager: true });
import.meta.glob("./components/*/tokens.css", { eager: true });

const delivered = Object.entries(modules)
  .map(([file, mod]) => {
    const name = file.split("/")[2];
    return { name, Comp: mod[name] as ComponentType | undefined };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

export function App() {
  return (
    <main className="pg">
      <header className="pg-head">
        <h1>Componentes</h1>
        <p>
          Cada uno con los valores por defecto de Figma. Se actualizan solos al entregar con{" "}
          <code>npm run react</code>.
        </p>
      </header>
      {delivered.length === 0 ? (
        <p className="pg-empty">
          Todavía no hay componentes. Desde la raíz de figspec: <code>npm run react -- &lt;componente&gt;</code>{" "}
          (con <code>FIGMA_REACT_DIR=figma-playground/src/components</code> en el <code>.env</code>).
        </p>
      ) : (
        delivered.map(({ name, Comp }) => (
          <section key={name} className="pg-item">
            <h2>{name}</h2>
            <div className="pg-stage">
              {Comp ? (
                <Boundary>
                  <Comp />
                </Boundary>
              ) : (
                <p className="pg-error">index.ts no exporta {name}.</p>
              )}
            </div>
          </section>
        ))
      )}
    </main>
  );
}

// Un componente que falla no tapa a los demás
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? <p className="pg-error">{this.state.error.message}</p> : this.props.children;
  }
}
