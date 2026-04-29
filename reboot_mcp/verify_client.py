"""
Quick smoke-test: connects to the running MCP server and lists tools.
Run after `rbt dev run` is up:
    cd reboot_mcp && uv run python verify_client.py
"""

import asyncio
from reboot.mcp.client import connect


async def main() -> None:
    print("Connecting to http://localhost:9991/mcp ...")
    async with connect("http://localhost:9991/mcp") as (session, session_id, _):
        print(f"Session ID: {session_id}\n")

        tools = await session.list_tools()
        print(f"Tools available ({len(tools.tools)}):")
        for tool in tools.tools:
            print(f"  · {tool.name} — {tool.description[:70]}...")

        print("\nCalling run_demo (classification) ...")
        result = await session.call_tool(
            "run_demo",
            arguments={"scenario": "classification"},
        )
        print(f"Result snippet: {str(result.content)[:200]}")


if __name__ == "__main__":
    asyncio.run(main())
