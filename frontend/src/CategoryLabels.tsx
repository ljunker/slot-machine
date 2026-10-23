import type { CategorySummary } from './types'

export function CategoryStripe({ categories = [] }: { categories?: CategorySummary[] }) {
  if (!categories.length) return null
  return <span className="category-stripe" aria-hidden="true">
    {categories.map(category => <span key={category.id} style={{ backgroundColor: category.color }} />)}
  </span>
}

export default function CategoryLabels({ categories = [] }: { categories?: CategorySummary[] }) {
  if (!categories.length) return null
  return <span className="category-labels" aria-label="Kategorien">
    {categories.map(category => <span className="category-label" key={category.id}>
      <span className="category-dot" style={{ backgroundColor: category.color }} />{category.name}
    </span>)}
  </span>
}
