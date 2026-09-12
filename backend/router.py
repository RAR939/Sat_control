from __future__ import annotations
from collections import deque

def find_path_bfs(edges: list, start_node: str, target_gateway: str, active_sats: set) -> list[str]:
    adjacency = {}
    for u, v, _ in edges:
        adjacency.setdefault(u, []).append(v)
        adjacency.setdefault(v, []).append(u)
    
    if start_node not in adjacency or target_gateway not in adjacency:
        return []
    
    queue = deque([[start_node]])
    visited = {start_node}
    
    while queue:
        path = queue.popleft()
        node = path[-1]
        if node == target_gateway:
            return path
        for neighbor in adjacency.get(node, []):
            if neighbor not in visited:
                if neighbor == target_gateway or neighbor in active_sats:
                    visited.add(neighbor)
                    queue.append(path + [neighbor])
    return []

def evaluate_and_repair_route(snap: dict, client: str, gateway: str, active_sats: set, existing_path: list[str]) -> tuple[list[str], str]:
    edge_set = set()
    for u, v, _ in snap['edges']:
        edge_set.add((u, v))
        edge_set.add((v, u))
        
    is_valid = True
    if not existing_path or existing_path[0] != client or existing_path[-1] != gateway:
        is_valid = False
    else:
        for i in range(len(existing_path) - 1):
            u, v = existing_path[i], existing_path[i+1]
            if (u, v) not in edge_set:
                is_valid = False
                break
            if u != client and u not in active_sats:
                is_valid = False
                break
            if v != gateway and v not in active_sats:
                is_valid = False
                break
                
    if is_valid:
        return existing_path, "OK"
        
    new_path = find_path_bfs(snap['edges'], client, gateway, active_sats)
    if new_path:
        return new_path, "REBUILT"

    # Маршрут не найден -- причина строго в этом порядке (см. CLAUDE.md):
    # NO_VISIBLE_SATELLITE -> GATEWAY_UNAVAILABLE -> NO_GATEWAY_CONNECTION
    # -> BROKEN_ISL_NETWORK.
    visible_sats = snap.get('visible_sats', {}).get(client, [])
    if not visible_sats:
        return [], "NO_VISIBLE_SATELLITE"

    gw_status = snap.get('gateway_status', {}).get(gateway, {})
    if gw_status.get('outage'):
        return [], "GATEWAY_UNAVAILABLE"

    if not gw_status.get('geometrically_reachable'):
        return [], "NO_GATEWAY_CONNECTION"

    return [], "BROKEN_ISL_NETWORK"

def compute_routes_for_snapshot(snap: dict, clients: list[str], gateway: str, active_sats: set, previous_routes: dict = None) -> tuple[dict, dict]:
    previous_routes = previous_routes or {}
    routes = {}
    rebuild_log = {}
    
    for client in clients:
        prev_path = previous_routes.get(client, [])
        path, status = evaluate_and_repair_route(snap, client, gateway, active_sats, prev_path)
        routes[client] = path
        rebuild_log[client] = status
        
    return routes, rebuild_log