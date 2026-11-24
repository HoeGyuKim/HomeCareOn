import { connection, type NextRequest } from "next/server";
import { errorResponse, readJson } from "@/lib/api-helpers";
import { getRepositories } from "@/lib/repositories";
import { validateContractor, type ContractorBody } from "@/lib/services/contractor-service";

export async function GET() {
  await connection();
  try {
    const { contractors, complaints } = getRepositories();
    const [items, load] = await Promise.all([contractors.list(), complaints.countActiveByContractor()]);
    return Response.json({ items, load });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = validateContractor(await readJson<ContractorBody>(request));
    const created = await getRepositories().contractors.create(body);
    return Response.json(created, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
