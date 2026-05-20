import sys

# Add backend to path
sys.path.append("e:\\WIMS-GIT\\WIMS-BFP-PROTOTYPE\\src\\backend")

from services.keycloak_admin import _get_admin_client, _KC_REALM

try:
    adm = _get_admin_client()
    try:
        print("get_realm():", adm.get_realm(_KC_REALM))
    except Exception as e:
        print("Error getting realm:", e)
except Exception as e:
    print("Error getting client:", e)
