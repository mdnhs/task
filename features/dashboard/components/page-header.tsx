import { Icon } from "@/components/icons"
import type { HeaderData } from "../types"

export function PageHeader({ data }: { data: HeaderData }) {
  return (
    <div className="head">
      <div>
        <h1>{data.title}</h1>
        <p>{data.subtitle}</p>
      </div>
      <div className="head-actions">
        <button className="btn btn-primary">
          <Icon name="plus" />
          New Task
        </button>
        <button className="btn btn-outline">
          <Icon name="report" />
          Start Daily Report
        </button>
      </div>
    </div>
  )
}
