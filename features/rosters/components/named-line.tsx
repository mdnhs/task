import { splitName } from "../publishing"

/** "<b>Ann Byrne</b> is on two shifts": the person once, then the API's sentence. */
export function NamedLine({ person, message }: { person: string; message: string }) {
  const { name, rest } = splitName(person, message)
  return (
    <>
      <b>{name}</b>
      {rest}
    </>
  )
}
