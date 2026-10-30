"use client"

import { useSyncExternalStore } from "react"

import { SkMask } from "@/components/sk"
import { tasksStore } from "../store"
import { TaskDetailSkeleton } from "./skeletons"
import { TaskDetail } from "./task-detail"

// loading.tsx for a ref the server seed doesn't have: a task created in this tab (it may carry voice instructions, which only
// live in the client store). When the client store has it, the real page is rendered masked like seeded tasks, so the skeleton
// stays exact; otherwise (first load, unknown ref) the typical-counts skeleton. The server snapshot is always "not known".
export function TaskDetailLoading({ skeleton, ...props }: React.ComponentProps<typeof TaskDetail> & { skeleton: { canEdit: boolean; reviewer: boolean } }) {
  const known = useSyncExternalStore(
    tasksStore.subscribe,
    () => !!tasksStore.get()?.some((t) => t.ref === props.taskRef),
    () => false,
  )
  if (!known) return <TaskDetailSkeleton {...skeleton} />
  return (
    <SkMask label="Loading task">
      <TaskDetail {...props} />
    </SkMask>
  )
}
