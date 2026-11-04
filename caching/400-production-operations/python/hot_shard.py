"""
Hot shard demonstration for Part B5 of the 400-level workshop.

Writes 1,000 short-lived keys to the cluster in one of two ways, so you can
compare where they land in /stats:

    python hot_shard.py spread   # keys with no hash tag: spread across the primaries
    python hot_shard.py tagged   # keys sharing one hash tag: all on one primary

The keys expire after 120 seconds, so the demo cleans up after itself.
Requires Part A2 (it reuses to_host_address from cache_layer.py).
"""

import os
import sys
from collections import Counter

from dotenv import load_dotenv
from valkey.cluster import ClusterNode, ValkeyCluster

try:
    from cache_layer import to_host_address
except ImportError:
    print("ERROR: cache_layer.py has no to_host_address(). Complete Part A2 first.")
    sys.exit(1)

COUNT = 1000
TTL_SECONDS = 120


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ("spread", "tagged"):
        print(__doc__)
        sys.exit(1)
    mode = sys.argv[1]

    load_dotenv()
    nodes_str = os.environ.get("VALKEY_CLUSTER_NODES", "localhost:7001")
    startup_nodes = [ClusterNode(host, int(port))
                     for host, port in [node.split(":") for node in nodes_str.split(",")]]
    client = ValkeyCluster(startup_nodes=startup_nodes, decode_responses=True,
                           address_remap=to_host_address)

    # Untagged keys hash on the whole name, so they scatter across all 16,384 slots.
    # Tagged keys hash only on "hot", the part inside the braces, so they share one slot.
    if mode == "tagged":
        keys = [f"demo:{{hot}}:{i}" for i in range(COUNT)]
    else:
        keys = [f"demo:{i}" for i in range(COUNT)]

    pipe = client.pipeline()
    for key in keys:
        pipe.set(key, "x", ex=TTL_SECONDS)
    pipe.execute()

    per_node = Counter(client.get_node_from_key(key).name for key in keys)
    print(f"Wrote {COUNT} {mode} keys (they expire in {TTL_SECONDS} seconds):")
    for node, count in sorted(per_node.items()):
        print(f"  {node}: {count} keys")
    print("Now open http://localhost:5000/stats and compare total_keys for each entry under \"nodes\".")


if __name__ == "__main__":
    main()
